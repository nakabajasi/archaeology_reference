// 版の表示と、更新したときに古いファイルを使わないための印。
// __BUILD__ は GitHub で公開するとき（.github/workflows/pages.yml）に、その版の印（コミットの番号と日時）に置き換わる。
// 手元で開いたときは __BUILD__ のまま（それでも動く）
export const VERSION = 'V0.1';
export const BUILD = '__BUILD__';
export const VERSION_LABEL = BUILD.startsWith('__') ? `${VERSION}（手元）` : `${VERSION}（${BUILD}）`;
