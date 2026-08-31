/**
 * Fail the build if any component calls a hook after an early return.
 *
 *   node tools/check-hook-order.mjs
 *
 * React requires every render to call the same hooks in the same order. A
 * component that returns early — `if (!conv) return <Loading/>` — and then calls
 * a hook further down runs fewer hooks on the loading render than on the loaded
 * one. React throws error #310 ("rendered more hooks than during the previous
 * render"), which is not caught by anything, unmounts the whole tree, and leaves
 * the user staring at a white page.
 *
 * This has now shipped twice: once as a `useEffect` below the thread's guards,
 * and once as a `useInboxes()` two hundred lines below them, which blanked the
 * web app on sign-in. Both were invisible in review because the hook was nowhere
 * near the return that broke it, and neither TypeScript nor the bundler has any
 * opinion about hook order.
 *
 * `eslint-plugin-react-hooks` is the usual home for this rule, but there is no
 * ESLint in this repo and adding one for a single rule is a lot of machinery.
 * TypeScript is already a dependency, so its parser does the work here — the
 * check has to be an AST walk regardless, since the early return is normally
 * nested inside an `if` and no amount of indentation-matching finds it.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps/web/src", "apps/mobile/src", "apps/mobile/app", "packages/client/src"];

/** Every .ts/.tsx under the given directories. */
function sources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "__tests__") sources(p, out);
    } else if (extname(e.name) === ".ts" || extname(e.name) === ".tsx") {
      out.push(p);
    }
  }
  return out;
}

const isFn = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n);

const problems = [];

for (const file of ROOTS.flatMap((r) => sources(resolve(root, r)))) {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const lineOf = (pos) => src.getLineAndCharacterOfPosition(pos).line + 1;

  /**
   * Walk one component body, ignoring anything inside a nested function — a
   * callback's returns and hook calls belong to a different render, or to no
   * render at all.
   */
  function check(name, body) {
    const returnEnds = [];
    const hooks = [];
    (function walk(n) {
      if (n !== body && isFn(n)) return;
      // The *end* of the return, not its start: `return useMutation(...)` is the
      // normal shape of a custom hook and calls nothing after anything.
      if (ts.isReturnStatement(n)) returnEnds.push(n.getEnd());
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        /^use[A-Z]/.test(n.expression.text)
      ) {
        hooks.push({ pos: n.getStart(), name: n.expression.text });
      }
      n.forEachChild(walk);
    })(body);

    if (!returnEnds.length) return;
    const firstReturn = Math.min(...returnEnds);
    for (const h of hooks) {
      if (h.pos <= firstReturn) continue;
      problems.push(
        `${relative(root, file)}:${lineOf(h.pos)}\n` +
          `    ${name}() calls ${h.name}() after the return on line ${lineOf(firstReturn)}.\n` +
          `    Move the call above that return; keep any derivation from it where it is.`,
      );
    }
  }

  (function visit(n) {
    let name = null;
    let fn = null;
    if (ts.isFunctionDeclaration(n) && n.name) {
      name = n.name.text;
      fn = n;
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      isFn(n.initializer)
    ) {
      name = n.name.text;
      fn = n.initializer;
    }
    // Only components (PascalCase) and custom hooks (useFoo) have hook rules.
    if (name && /^([A-Z]|use[A-Z])/.test(name) && fn?.body && ts.isBlock(fn.body)) {
      check(name, fn.body);
    }
    n.forEachChild(visit);
  })(src);
}

if (problems.length) {
  console.error(`Hook order: ${problems.length} violation(s) — these blank the screen at runtime.\n`);
  console.error(problems.join("\n\n"));
  process.exit(1);
}
console.log("Hook order: no hooks called after an early return.");
