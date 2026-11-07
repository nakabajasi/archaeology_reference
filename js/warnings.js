// AR 画面の注意書き。モデルは隠さず、画面の上の方に短い文で出す。
//   ゆっくり動かしてください。     スマホを急に回した・動かした（動きのセンサーで見る）
//   画像に近すぎます。離れてください。 追跡中の手がかりが warnPoints 点以下で、図面に近いとき
//                                    （近すぎて見失ったときは、見失ったときの案内を「少し離れて」に替える：wasNear）
//   画像認識が不安定です。           手ブレで図面の見え方が細かく行き来している・追い直している・
//                                    手がかりが少ないのに近くはないとき（ピンぼけ・暗い・斜めすぎなど）
// 複数当てはまるときは上の順で1つだけ出す。条件が warnOnMs 続いたら出し（急な動きはすぐ）、
// 条件が消えてから warnOffMs たったら消す（点滅しないように）
import * as THREE from 'three';

export const WARN_TEXT = {
  sudden: 'ゆっくり動かしてください。',
  near: '画像に近すぎます。離れてください。',
  unstable: '画像認識が不安定です。',
};
const ORDER = ['sudden', 'near', 'unstable'];

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

export function createWarnings({ el, cfg, camera }) {
  const state = { sudden: {}, near: {}, unstable: {} };
  const samples = [];        // 図面の中心が画面のどこに見えたか（画面の幅・高さに対する割合）
  let key = NaN;
  let ratio = 0;             // カメラから図面の中心までの距離 ÷ 図面の長辺
  let nearLowAt = -1e9;      // 「近くて手がかりが少ない」を最後に見た時刻
  let gyroSeen = false;      // 動きのセンサーの値が届いているか（許可されなかった端末では届かない）
  let rate = 0;              // スマホの回る速さ（度/秒）
  let accel = 0;             // スマホの動きの勢い（m/秒²、重力を除く）
  let suddenAt = -1e9;
  let current = '';
  const info = { shown: '', shake: 0, speed: 0, ratio: 0, rate: 0, accel: 0, gyro: false, points: 0 };

  window.addEventListener('devicemotion', (e) => {
    const r = e.rotationRate;
    if (r && (r.alpha != null || r.beta != null || r.gamma != null)) {
      gyroSeen = true;
      rate = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
    }
    const a = e.acceleration;
    accel = a && a.x != null ? Math.hypot(a.x || 0, a.y || 0, a.z || 0) : 0;
    if (rate > cfg.warnTurn || accel > cfg.warnAccel) suddenAt = performance.now();
  });

  // MindAR が出した生の姿勢（見失っているときは null）から、図面の中心の画面上の位置と距離を記録する
  function sample(matrix, aspect, now) {
    if (!matrix) { samples.length = 0; key = NaN; return; }
    const e = matrix.elements;
    const k = e[12] + e[13] * 3 + e[14] * 7 + e[0] * 11 + e[5] * 13;
    if (k === key) return;   // 追跡は描画より遅いので、同じ姿勢が何コマか続く
    key = k;
    matrix.decompose(_p, _q, _s);
    ratio = _p.length() / Math.max(_s.x * Math.max(1, aspect), 1e-6);
    _v.copy(_p).project(camera);
    samples.push({ t: now, x: _v.x / 2, y: _v.y / 2 });
    while (samples.length && now - samples[0].t > cfg.warnWindowMs) samples.shift();
  }

  // 直近 warnWindowMs の動き。行ったり来たりした分（手ブレ）と、一方向に動いた分（速さ）に分ける。単位は画面/秒
  function motion() {
    if (samples.length < 4) return { shake: 0, speed: 0 };
    let path = 0;
    for (let i = 1; i < samples.length; i += 1) {
      path += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    }
    const a = samples[0];
    const b = samples[samples.length - 1];
    const net = Math.hypot(b.x - a.x, b.y - a.y);
    const sec = Math.max((b.t - a.t) / 1000, 0.15);
    return { shake: (path - net) / sec, speed: net / sec };
  }

  function show(k) {
    if (k === current) return;
    current = k;
    el.textContent = k ? WARN_TEXT[k] : '';
    el.hidden = !k;
  }

  // 描画のたびに呼ぶ。tracking：いま図面を追えているか、points：手がかりの数、struggling：追い直し中か
  function update({ matrix, aspect, tracking, points, struggling, now }) {
    if (!cfg.warn) { show(''); return; }
    sample(tracking ? matrix : null, aspect, now);
    const m = motion();
    const low = tracking && points > 0 && points <= cfg.warnPoints;
    const close = ratio > 0 && ratio < cfg.warnNear;
    if (low && close) nearLowAt = now;
    const cond = {
      sudden: now - suddenAt < 250 || (!gyroSeen && tracking && m.speed > cfg.warnSpeed),
      near: low && close,
      unstable: tracking && ((low && !close) || m.shake > cfg.warnShake || struggling),
    };
    let pick = '';
    for (const k of ORDER) {
      const s = state[k];
      if (cond[k]) { if (!s.since) s.since = now; s.last = now; } else s.since = 0;
      const wait = k === 'sudden' ? 0 : cfg.warnOnMs;
      s.shown = Boolean((s.since && now - s.since >= wait) || (s.shown && now - s.last < cfg.warnOffMs));
      if (s.shown && !pick) pick = k;
    }
    show(pick);
    Object.assign(info, { shown: pick, shake: m.shake, speed: m.speed, ratio, rate, accel, gyro: gyroSeen, points });
  }

  // 近すぎて手がかりが減ったすぐあとか（見失ったときの案内を選ぶのに使う）
  const wasNear = (now = performance.now()) => now - nearLowAt < cfg.warnLostNearMs;

  return { update, info, show, wasNear };
}
