import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

// Isolated, in-memory TS module graph. No generated files, DB, network or env files.
export function tsLoader(mocks = {}) {
  const cache = new Map();
  function load(path) {
    const filename = resolve(path);
    const relative = filename.slice(process.cwd().length + 1);
    if (relative in mocks) return mocks[relative];
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const localRequire = createRequire(filename);
    const require = (specifier) => {
      if (!specifier.startsWith(".")) return specifier in mocks ? mocks[specifier] : localRequire(specifier);
      const base = resolve(dirname(filename), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((item) => existsSync(item) && /\.[cm]?[jt]sx?$/.test(item));
      if (!target) return localRequire(specifier);
      return load(target);
    };
    const js = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const fn = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${js}\n})`, { filename });
    fn(require, mod, mod.exports, filename, dirname(filename));
    return mod.exports;
  }
  return load;
}
