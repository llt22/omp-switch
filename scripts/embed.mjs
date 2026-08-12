// 将 web/dist 产物内嵌为 TS 模块（供单文件二进制使用）
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const dist = join(import.meta.dir, '..', 'web', 'dist');
const out = join(import.meta.dir, '..', 'embedded.ts');

function collect(dir) {
  const files = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      for (const [k, v] of Object.entries(collect(p))) files[`/${name}${k}`] = v;
    } else {
      files[`/${name}`] = readFileSync(p, 'utf8');
    }
  }
  return files;
}

const files = collect(dist);
if (!files['/index.html']) {
  console.error('web/dist 缺少 index.html，请先执行 cd web && bunx vite build');
  process.exit(1);
}

const body = Object.entries(files)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n');
writeFileSync(out, `// 自动生成：bun scripts/embed.mjs（由 web/dist 构建产物生成，勿手改）\nexport const FILES: Record<string, string> = {\n${body}\n};\n`);
console.log(`embedded.ts 生成：${Object.keys(files).length} 个文件`);
