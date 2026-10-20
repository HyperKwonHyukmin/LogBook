/**
 * 설명회 통합 데모를 파일 하나로 만든다 → docs/demo/LogBook-설명회-통합데모.html
 *
 *   cd frontend
 *   node demo/build.mjs
 *
 * 실제 앱 화면(src/pages 의 관계 지도 · 갖춤 현황 · 선례 찾기)을 그대로 묶고, 서버 대신 예시 데이터(demo/data.js ·
 * demo/mockApi.js)가 답한다. 화면을 고친 뒤 다시 돌리면 데모도 같은 모습이 된다. 인터넷 · 서버가 필요 없다.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '../node_modules/.demo-build');
const target = path.join(here, '../../docs/demo/LogBook-설명회-통합데모.html');

await build({ configFile: path.join(here, 'vite.config.js'), logLevel: 'warn' });

const assets = path.join(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1 || css.length !== 1) throw new Error(`묶음이 하나가 아닙니다: ${files.join(', ')}`);

let html = readFileSync(path.join(outDir, 'demo', 'index.html'), 'utf8');
const code = readFileSync(path.join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = readFileSync(path.join(assets, css[0]), 'utf8').replace(/<\/style/gi, '<\\/style');
html = html
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, () => '')
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>${style}</style>`)
  // 모듈 스크립트는 문서를 다 읽은 뒤 실행된다(#root 가 있어야 하므로 body 끝에 둔다)
  .replace('</body>', () => `<script type="module">${code}</script>\n</body>`);
if (/(src|href)="[^"]*assets\//.test(html)) throw new Error('밖 파일을 가리키는 주소가 남았습니다');
writeFileSync(target, html);
console.log(`만듦: ${path.relative(process.cwd(), target)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
