/**
 * Auditor impor: memastikan (1) setiap import relatif menunjuk ke berkas yang ada, (2) setiap import paket
 * dideklarasikan di package.json terdekat (atau root), (3) subpath paket workspace (@ficoim/x/sub) ada di "exports".
 * Menangkap galat "Cannot find module" SEBELUM npm install/build.     npm run audit
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.expo', 'data', '.git']);
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];
const builtins = new Set(builtinModules);

type Pkg = { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; exports?: Record<string, unknown> | string; workspaces?: string[] };
const readPkg = (dir: string): Pkg => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg;
const depsOf = (p: Pkg) => new Set(Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies, ...p.optionalDependencies }));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// paket workspace
const workspaces = new Map<string, { dir: string; pkg: Pkg }>();
for (const base of ['packages', 'apps']) for (const d of readdirSync(join(root, base))) {
  const dir = join(root, base, d);
  if (existsSync(join(dir, 'package.json'))) { const pkg = readPkg(dir); if (pkg.name) workspaces.set(pkg.name, { dir, pkg }); }
}
const rootDeps = depsOf(readPkg(root));
const nearestPkgDir = (file: string): string => { let d = dirname(file); while (!existsSync(join(d, 'package.json'))) d = dirname(d); return d; };

const RE = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const problems: string[] = [];
const files = [...walk(join(root, 'packages')), ...walk(join(root, 'apps')), ...walk(join(root, 'scripts'))];

for (const file of files) {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pkgDir = nearestPkgDir(file);
  const allowed = new Set([...depsOf(readPkg(pkgDir)), ...rootDeps]);
  for (const m of src.matchAll(RE)) {
    const spec = (m[1] ?? m[2] ?? m[3]) as string;
    const where = `${relative(root, file)}: "${spec}"`;
    if (spec.startsWith('.')) {
      const base = resolve(dirname(file), spec);
      if (!EXT.some((e) => existsSync(base + e) && statSync(base + e).isFile())) problems.push(`BERKAS TIDAK ADA  ${where}`);
      continue;
    }
    if (spec.startsWith('node:') || builtins.has(spec.split('/')[0] as string)) continue;
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
    const sub = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
    if (!allowed.has(name) && !(workspaces.has(name) && pkgDir === workspaces.get(name)?.dir)) { problems.push(`PAKET BELUM DIDEKLARASIKAN  ${where}  (tambahkan "${name}" ke ${relative(root, join(pkgDir, 'package.json'))})`); continue; }
    const ws = workspaces.get(name);
    if (ws && sub) {
      const ex = ws.pkg.exports;
      if (!ex || typeof ex === 'string' || !(`./${sub}` in ex)) problems.push(`SUBPATH TIDAK DIEKSPOR  ${where}  (tambahkan "./${sub}" ke exports ${name})`);
      else { const t = (ex as Record<string, string>)[`./${sub}`] as string; if (!existsSync(join(ws.dir, t))) problems.push(`TARGET EXPORTS TIDAK ADA  ${where} -> ${t}`); }
    }
    if (name.startsWith('@ficoim/') && !ws) problems.push(`PAKET WORKSPACE TIDAK DIKENAL  ${where}`);
  }
}

// deklarasi workspace yang menunjuk ke paket yang tidak ada
for (const [n, { pkg }] of workspaces) for (const d of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) if (d.startsWith('@ficoim/') && !workspaces.has(d)) problems.push(`DEPENDENSI WORKSPACE TIDAK ADA  ${n} -> ${d}`);

console.log(`Audit impor: ${files.length} berkas diperiksa.`);
if (problems.length) { console.error(`\n${problems.length} masalah:\n - ${[...new Set(problems)].join('\n - ')}`); process.exit(1); }
console.log('Semua impor valid: berkas ada, paket terdeklarasi, subpath diekspor.');
