var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// packages/prunelle/src/ts-plugin/index.ts
var exports_ts_plugin = {};
__export(exports_ts_plugin, {
  PRUNELLE_CODE: () => PRUNELLE_CODE,
  PRUNELLE_DIAG_SOURCE: () => PRUNELLE_DIAG_SOURCE,
  PRUNELLE_FIXABLE_CODES: () => PRUNELLE_FIXABLE_CODES,
  collectPrunelleDiagnostics: () => collectPrunelleDiagnostics,
  createPrunellePlugin: () => createPrunellePlugin,
  default: () => ts_plugin_default,
  getPrunelleCodeFixes: () => getPrunelleCodeFixes,
  getPrunelleDiagnostics: () => getPrunelleDiagnostics
});
module.exports = __toCommonJS(exports_ts_plugin);

// packages/prunelle/src/ts-plugin/diagnostics.ts
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");
var import_oxc_parser8 = require("oxc-parser");

// packages/prunelle/src/build/files.ts
var import_node_path = require("node:path");
var BACKSLASH_RE = /\\/g;
var NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
function relPosix(from, to) {
  return import_node_path.relative(from, to).replace(BACKSLASH_RE, "/");
}
function isInNodeModules(file) {
  return NODE_MODULES_RE.test(file);
}

// packages/prunelle/src/compiler/analyze.ts
var import_oxc_parser7 = require("oxc-parser");

// packages/prunelle/src/compiler/ast.ts
var import_oxc_parser = require("oxc-parser");
function computeJsxNodes(program) {
  const jsxNodes = new WeakSet;
  const visit = (node) => {
    if (node === null || typeof node !== "object")
      return false;
    if (Array.isArray(node)) {
      let any = false;
      for (let i = 0;i < node.length; i++) {
        if (visit(node[i]))
          any = true;
      }
      return any;
    }
    const ast = node;
    const type = ast.type;
    if (typeof type !== "string")
      return false;
    let found = type === "JSXElement" || type === "JSXFragment";
    const keys = import_oxc_parser.visitorKeys[type];
    if (keys !== undefined) {
      const rec = ast;
      for (let i = 0;i < keys.length; i++) {
        const val = rec[keys[i]];
        if (val !== null && typeof val === "object" && visit(val))
          found = true;
      }
    } else {
      for (const [key, val] of Object.entries(ast)) {
        if (key === "start" || key === "end" || key === "type")
          continue;
        if (val !== null && typeof val === "object" && visit(val))
          found = true;
      }
    }
    if (found)
      jsxNodes.add(ast);
    return found;
  };
  visit(program);
  return jsxNodes;
}
function walk(node, visit) {
  if (node === null || typeof node !== "object")
    return;
  if (Array.isArray(node)) {
    for (let i = 0;i < node.length; i++)
      walk(node[i], visit);
    return;
  }
  const ast = node;
  const type = ast.type;
  if (typeof type !== "string")
    return;
  if (visit(ast) === false)
    return;
  const keys = import_oxc_parser.visitorKeys[type];
  if (keys !== undefined) {
    const rec = ast;
    for (let i = 0;i < keys.length; i++) {
      const val = rec[keys[i]];
      if (val !== null && typeof val === "object")
        walk(val, visit);
    }
    return;
  }
  for (const [key, val] of Object.entries(ast)) {
    if (key === "start" || key === "end" || key === "type")
      continue;
    if (val !== null && typeof val === "object")
      walk(val, visit);
  }
}

// packages/prunelle/src/compiler/scope.ts
var import_oxc_parser2 = require("oxc-parser");

// packages/prunelle/src/attrs.ts
var URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data"]);
var UNSAFE_URL_RE = /^(?:javascript|vbscript):/i;
var SAFE_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|ico|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/i;
var STRING_BOOL_ATTRS = new Set(["draggable", "spellcheck", "contenteditable"]);
var DOM_PROPS = new Set(["value", "checked", "selected", "muted", "indeterminate"]);
function isUnsafeUrlAttr(name, value, tag) {
  const lower = name.toLowerCase();
  if (!URL_ATTRS.has(lower))
    return false;
  const cleaned = String(value).replace(/[\u0000-\u0020]+/g, "");
  if (UNSAFE_URL_RE.test(cleaned))
    return true;
  if (!/^data:/i.test(cleaned))
    return false;
  if (lower === "src" || lower === "href" && tag?.toLowerCase() === "link")
    return !SAFE_IMAGE_DATA_URL_RE.test(cleaned);
  return true;
}
// packages/prunelle/src/compiler/shared.ts
var VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
var RAW_TEXT_ELEMENTS = new Set(["style", "script"]);
var EVENT_ATTR = /^on([A-Z]\w*)$/;
var LINE_BREAK_RE = /\r\n|\n|\r/;
var HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "‌",
  zwj: "‍",
  lrm: "‎",
  rlm: "‏",
  shy: "­",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  prime: "′",
  Prime: "″",
  sect: "§",
  para: "¶",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  iexcl: "¡",
  iquest: "¿",
  brvbar: "¦",
  macr: "¯",
  acute: "´",
  cedil: "¸",
  uml: "¨",
  ordf: "ª",
  ordm: "º",
  not: "¬",
  loz: "◊",
  spades: "♠",
  clubs: "♣",
  hearts: "♥",
  diams: "♦",
  star: "☆",
  check: "✓",
  checkmark: "✓",
  cross: "✗",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  curren: "¤",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  minus: "−",
  ne: "≠",
  le: "≤",
  ge: "≥",
  approx: "≈",
  infin: "∞",
  sum: "∑",
  prod: "∏",
  radic: "√",
  int: "∫",
  part: "∂",
  empty: "∅",
  nabla: "∇",
  isin: "∈",
  notin: "∉",
  ni: "∋",
  cap: "∩",
  cup: "∪",
  sub: "⊂",
  sup: "⊃",
  nsub: "⊄",
  sube: "⊆",
  supe: "⊇",
  oplus: "⊕",
  otimes: "⊗",
  perp: "⊥",
  sdot: "⋅",
  equiv: "≡",
  cong: "≅",
  asymp: "≈",
  prop: "∝",
  and: "∧",
  or: "∨",
  forall: "∀",
  exist: "∃",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
  harr: "↔",
  crarr: "↵",
  lArr: "⇐",
  uArr: "⇑",
  rArr: "⇒",
  dArr: "⇓",
  hArr: "⇔",
  Alpha: "Α",
  Beta: "Β",
  Gamma: "Γ",
  Delta: "Δ",
  Epsilon: "Ε",
  Zeta: "Ζ",
  Eta: "Η",
  Theta: "Θ",
  Iota: "Ι",
  Kappa: "Κ",
  Lambda: "Λ",
  Mu: "Μ",
  Nu: "Ν",
  Xi: "Ξ",
  Omicron: "Ο",
  Pi: "Π",
  Rho: "Ρ",
  Sigma: "Σ",
  Tau: "Τ",
  Upsilon: "Υ",
  Phi: "Φ",
  Chi: "Χ",
  Psi: "Ψ",
  Omega: "Ω",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  rho: "ρ",
  sigmaf: "ς",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Auml: "Ä",
  Aring: "Å",
  AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Igrave: "Ì",
  Iacute: "Í",
  Icirc: "Î",
  Iuml: "Ï",
  ETH: "Ð",
  Ntilde: "Ñ",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ouml: "Ö",
  Oslash: "Ø",
  Ugrave: "Ù",
  Uacute: "Ú",
  Ucirc: "Û",
  Uuml: "Ü",
  Yacute: "Ý",
  THORN: "Þ",
  szlig: "ß",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  eth: "ð",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  thorn: "þ",
  yuml: "ÿ",
  OElig: "Œ",
  oelig: "œ",
  Scaron: "Š",
  scaron: "š",
  Yuml: "Ÿ"
};
var ENTITY_RE = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g;
function decodeHtmlEntities(str) {
  if (!str.includes("&"))
    return str;
  return str.replace(ENTITY_RE, (match, dec, hex, named) => {
    if (dec !== undefined) {
      const cp = Number.parseInt(dec, 10);
      return cp === 0 || cp > 1114111 || cp >= 55296 && cp <= 57343 ? "�" : String.fromCodePoint(cp);
    }
    if (hex !== undefined) {
      const cp = Number.parseInt(hex, 16);
      return cp === 0 || cp > 1114111 || cp >= 55296 && cp <= 57343 ? "�" : String.fromCodePoint(cp);
    }
    if (named !== undefined && Object.hasOwn(HTML_ENTITIES, named))
      return HTML_ENTITIES[named];
    return match;
  });
}
function offsetToLineCol(code, offset) {
  let line = 1;
  let col = 1;
  const end = Math.min(Math.max(0, offset), code.length);
  for (let i = 0;i < end; i++) {
    if (code.charCodeAt(i) === 10) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
function formatLoc(filename, code, offset) {
  if (offset === undefined || offset < 0)
    return filename;
  const { line, col } = offsetToLineCol(code, offset);
  return `${filename}:${line}:${col}`;
}
function formatCodeFrame(code, offset, endOffset) {
  if (code.length === 0)
    return "";
  const clamped = Math.min(Math.max(0, offset), code.length);
  const { line, col } = offsetToLineCol(code, clamped);
  const lines = code.split(/\r?\n/);
  const lineIdx = Math.min(line - 1, lines.length - 1);
  const startIdx = Math.max(0, lineIdx - 1);
  const endIdx = Math.min(lines.length - 1, lineIdx + 1);
  const gutterWidth = String(endIdx + 1).length;
  const pad = (n) => String(n).padStart(gutterWidth, " ");
  const targetLine = lines[lineIdx] ?? "";
  const maxSpan = Math.max(1, targetLine.length - (col - 1));
  const rawSpan = endOffset !== undefined && endOffset > clamped ? endOffset - clamped : 1;
  const caretLen = Math.max(1, Math.min(rawSpan, maxSpan));
  const out = [];
  for (let i = startIdx;i <= endIdx; i++) {
    const text = lines[i] ?? "";
    out.push(`  ${pad(i + 1)} | ${text}`);
    if (i === lineIdx)
      out.push(`  ${pad("")} | ${" ".repeat(Math.max(0, col - 1))}${"^".repeat(caretLen)}`);
  }
  return out.join(`
`);
}
function formatDiagnostic(loc, message, severity = "error") {
  return `${loc}: ${severity}: ${message}`;
}
function cleanJsxText(raw) {
  if (!LINE_BREAK_RE.test(raw))
    return raw;
  const lines = raw.split(LINE_BREAK_RE);
  let out = "";
  for (let i = 0;i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, " ");
    if (i > 0)
      line = line.replace(/^ +/, "");
    if (i < lines.length - 1)
      line = line.replace(/ +$/, "");
    if (line !== "") {
      if (out !== "")
        out += " ";
      out += line;
    }
  }
  return out;
}
function jsxTagName(node) {
  if (node.type === "JSXIdentifier")
    return node.name;
  if (node.type === "JSXMemberExpression")
    return `${jsxTagName(node.object)}.${node.property.name}`;
  if (node.type === "JSXNamespacedName")
    return `${node.namespace.name}:${node.name.name}`;
  return "";
}
function isComponentTag(tag) {
  const first = tag.charCodeAt(0);
  return first >= 65 && first <= 90 || tag.includes(".");
}
function unwrapParens(node) {
  let cur = node;
  while (cur.type === "ParenthesizedExpression")
    cur = cur.expression;
  return cur;
}
function calleeName(callee) {
  if (callee.type === "Identifier")
    return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && callee.property.type === "Identifier")
    return `${callee.object.name}.${callee.property.name}`;
  return "";
}
function unwrapTsExpr(node) {
  let cur = node;
  while (cur.type === "ParenthesizedExpression" || cur.type === "TSAsExpression" || cur.type === "TSSatisfiesExpression" || cur.type === "TSNonNullExpression" || cur.type === "TSTypeAssertion") {
    cur = cur.expression;
  }
  return cur;
}
function staticLiteral(node) {
  const n = unwrapParens(node);
  if (n.type === "Literal") {
    const v = n.value;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)
      return { ok: true, value: v };
  }
  if (n.type === "UnaryExpression" && n.operator === "-" && n.argument.type === "Literal" && typeof n.argument.value === "number")
    return { ok: true, value: -n.argument.value };
  return { ok: false };
}
function isJsxNode(node) {
  return node?.type === "JSXElement" || node?.type === "JSXFragment";
}
function containsJsx(node, jsxNodes) {
  if (node === null || node === undefined)
    return false;
  if (jsxNodes !== undefined)
    return jsxNodes.has(node);
  let found = false;
  walk(node, (child) => {
    if (found)
      return false;
    if (isJsxNode(child))
      found = true;
    return;
  });
  return found;
}
function filterMeaningfulChildren(children) {
  return children.filter((c) => {
    if (c.type === "JSXText")
      return cleanJsxText(c.value) !== "";
    if (c.type === "JSXExpressionContainer" && c.expression.type === "JSXEmptyExpression")
      return false;
    if (c.type === "JSXExpressionContainer" && c.expression.type === "Literal" && c.expression.value === "")
      return false;
    return true;
  });
}
function collectPatternNames(pattern, out) {
  if (pattern === null || pattern === undefined)
    return;
  switch (pattern.type) {
    case "Identifier":
      out.add(pattern.name);
      return;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, out);
      return;
    case "RestElement":
      collectPatternNames(pattern.argument, out);
      return;
    case "TSParameterProperty":
      collectPatternNames(pattern.parameter, out);
      return;
    case "ArrayPattern":
      for (const el of pattern.elements) {
        if (el !== null)
          collectPatternNames(el, out);
      }
      return;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement")
          collectPatternNames(prop.argument, out);
        else
          collectPatternNames(prop.value, out);
      }
  }
}
var PRUNELLE_TAGS = new Set(["Head", "Region", "Suspense", "ConsentGate", "Catch"]);
function resolvePrunelleTag(tag, imports) {
  let boundElsewhere = false;
  for (const imp of imports) {
    const isPrunelle = imp.source === "prunelle";
    for (const spec of imp.specifiers) {
      if (isPrunelle) {
        if (spec.local === tag && PRUNELLE_TAGS.has(spec.imported))
          return spec.imported;
        if (spec.imported === "*" && tag.startsWith(`${spec.local}.`)) {
          const member = tag.slice(spec.local.length + 1);
          if (PRUNELLE_TAGS.has(member))
            return member;
        }
      } else if (spec.local === tag) {
        boundElsewhere = true;
      }
    }
  }
  if (!boundElsewhere && PRUNELLE_TAGS.has(tag))
    return tag;
  return;
}

// packages/prunelle/src/compiler/scope.ts
function walkScoped(rootNode, callbacks) {
  const { shouldStop, onIdentifier, onWrite, onShorthandProperty, onJsx, onFunction } = callbacks;
  const reportPatternWrites = (target, shadowed) => {
    if (onWrite === undefined)
      return;
    const written = new Set;
    collectPatternNames(target, written);
    for (const name of written) {
      if (!shadowed.has(name))
        onWrite(name, shadowed);
    }
  };
  function visitPatternDefaults(pattern, shadowed) {
    if (pattern === null || pattern === undefined || shouldStop?.())
      return;
    switch (pattern.type) {
      case "AssignmentPattern":
        visitPatternDefaults(pattern.left, shadowed);
        visit(pattern.right, shadowed);
        return;
      case "RestElement":
        visitPatternDefaults(pattern.argument, shadowed);
        return;
      case "TSParameterProperty":
        visitPatternDefaults(pattern.parameter, shadowed);
        return;
      case "ArrayPattern":
        for (const el of pattern.elements)
          visitPatternDefaults(el, shadowed);
        return;
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          if (prop.type === "RestElement") {
            visitPatternDefaults(prop.argument, shadowed);
          } else {
            if (prop.computed)
              visit(prop.key, shadowed);
            visitPatternDefaults(prop.value, shadowed);
          }
        }
    }
  }
  function visit(node, shadowed) {
    if (node === null || node === undefined || shouldStop?.())
      return;
    if (onJsx !== undefined && isJsxNode(node)) {
      onJsx(node, shadowed);
      return;
    }
    switch (node.type) {
      case "Identifier": {
        if (!shadowed.has(node.name))
          onIdentifier?.(node, shadowed);
        return;
      }
      case "MemberExpression": {
        visit(node.object, shadowed);
        if (node.computed)
          visit(node.property, shadowed);
        return;
      }
      case "MetaProperty":
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "LabeledStatement": {
        visit(node.body, shadowed);
        return;
      }
      case "Property": {
        if (node.computed)
          visit(node.key, shadowed);
        if (node.shorthand && node.value.type === "Identifier" && onShorthandProperty?.(node, shadowed) === true)
          return;
        visit(node.value, shadowed);
        return;
      }
      case "MethodDefinition":
      case "PropertyDefinition": {
        if (node.computed)
          visit(node.key, shadowed);
        visit(node.value, shadowed);
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const next = new Set(shadowed);
        if (node.id !== null)
          next.add(node.id.name);
        visit(node.superClass, shadowed);
        visit(node.body, next);
        return;
      }
      case "CatchClause": {
        const next = new Set(shadowed);
        visitPatternDefaults(node.param, next);
        collectPatternNames(node.param, next);
        visit(node.body, next);
        return;
      }
      case "ForStatement": {
        const next = new Set(shadowed);
        if (node.init !== null) {
          if (node.init.type === "VariableDeclaration") {
            for (const d of node.init.declarations) {
              visit(d.init, next);
              visitPatternDefaults(d.id, next);
              collectPatternNames(d.id, next);
            }
          } else {
            visit(node.init, next);
          }
        }
        visit(node.test, next);
        visit(node.update, next);
        visit(node.body, next);
        return;
      }
      case "AssignmentExpression": {
        reportPatternWrites(node.left, shadowed);
        visit(node.left, shadowed);
        visit(node.right, shadowed);
        return;
      }
      case "UpdateExpression": {
        if (onWrite !== undefined && node.argument.type === "Identifier" && !shadowed.has(node.argument.name))
          onWrite(node.argument.name, shadowed);
        visit(node.argument, shadowed);
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        visit(node.right, shadowed);
        const next = new Set(shadowed);
        if (node.left.type === "VariableDeclaration") {
          for (const d of node.left.declarations) {
            visitPatternDefaults(d.id, next);
            collectPatternNames(d.id, next);
          }
        } else {
          reportPatternWrites(node.left, next);
          visit(node.left, next);
        }
        visit(node.body, next);
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant, shadowed);
        const caseShadow = new Set(shadowed);
        for (const c of node.cases) {
          for (const stmt of c.consequent) {
            if (stmt.type === "FunctionDeclaration" && stmt.id !== null)
              caseShadow.add(stmt.id.name);
            else if (stmt.type === "ClassDeclaration" && stmt.id !== null)
              caseShadow.add(stmt.id.name);
          }
        }
        for (const c of node.cases) {
          visit(c.test, caseShadow);
          for (const stmt of c.consequent) {
            if (stmt.type === "VariableDeclaration") {
              for (const d of stmt.declarations) {
                visit(d.init, caseShadow);
                visitPatternDefaults(d.id, caseShadow);
                collectPatternNames(d.id, caseShadow);
              }
            } else {
              visit(stmt, caseShadow);
            }
          }
        }
        return;
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration": {
        if (node !== rootNode && onFunction?.(node, shadowed) === true)
          return;
        const nextShadow = new Set(shadowed);
        if (node.type !== "ArrowFunctionExpression" && node.id !== null)
          nextShadow.add(node.id.name);
        for (const p of node.params) {
          visitPatternDefaults(p, nextShadow);
          collectPatternNames(p, nextShadow);
        }
        visit(node.body, nextShadow);
        return;
      }
      case "BlockStatement": {
        const nextShadow = new Set(shadowed);
        for (const stmt of node.body) {
          if (stmt.type === "FunctionDeclaration" && stmt.id !== null)
            nextShadow.add(stmt.id.name);
          else if (stmt.type === "ClassDeclaration" && stmt.id !== null)
            nextShadow.add(stmt.id.name);
        }
        for (const stmt of node.body) {
          if (stmt.type === "VariableDeclaration") {
            for (const d of stmt.declarations) {
              visit(d.init, nextShadow);
              visitPatternDefaults(d.id, nextShadow);
              collectPatternNames(d.id, nextShadow);
            }
          } else {
            visit(stmt, nextShadow);
          }
        }
        return;
      }
      case "VariableDeclaration": {
        const nextShadow = new Set(shadowed);
        for (const d of node.declarations) {
          visit(d.init, nextShadow);
          visitPatternDefaults(d.id, nextShadow);
          collectPatternNames(d.id, nextShadow);
        }
        return;
      }
      case "VariableDeclarator": {
        visit(node.init, shadowed);
        visitPatternDefaults(node.id, shadowed);
        return;
      }
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression": {
        visit(node.expression, shadowed);
        return;
      }
      default: {
        if (node.type.startsWith("TS"))
          return;
        const keys = import_oxc_parser2.visitorKeys[node.type];
        if (keys !== undefined) {
          const rec = node;
          for (let i = 0;i < keys.length; i++) {
            const val = rec[keys[i]];
            if (Array.isArray(val)) {
              for (let j = 0;j < val.length; j++) {
                const item = val[j];
                if (item !== null && typeof item === "object" && "type" in item)
                  visit(item, shadowed);
              }
            } else if (val !== null && typeof val === "object" && "type" in val) {
              visit(val, shadowed);
            }
          }
          return;
        }
        for (const [key, val] of Object.entries(node)) {
          if (key === "start" || key === "end" || key === "type")
            continue;
          if (Array.isArray(val)) {
            for (let i = 0;i < val.length; i++) {
              const item = val[i];
              if (item !== null && typeof item === "object" && "type" in item)
                visit(item, shadowed);
            }
          } else if (val !== null && typeof val === "object" && "type" in val) {
            visit(val, shadowed);
          }
        }
      }
    }
  }
  visit(rootNode, new Set);
}

// packages/prunelle/src/compiler/browser-globals.ts
var BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "location",
  "history",
  "screen",
  "indexedDB",
  "caches",
  "customElements",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "getSelection",
  "innerWidth",
  "innerHeight",
  "scrollX",
  "scrollY",
  "devicePixelRatio",
  "visualViewport",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "HTMLElement",
  "Notification"
]);
var MENTIONS_RE = new RegExp(`\\b(?:${[...BROWSER_GLOBALS].join("|")})\\b`);
var EAGER_CALLBACK_METHODS = new Set(["map", "flatMap", "filter", "forEach", "reduce", "some", "every", "find", "findIndex", "sort", "toSorted"]);
function topLevelFunctions(program) {
  const fns = new Map;
  for (const stmt of program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "FunctionDeclaration" && decl.id !== null) {
      fns.set(decl.id.name, decl);
    } else if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        const init = d.init === null ? undefined : unwrapTsExpr(d.init);
        if (d.id.type === "Identifier" && (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression"))
          fns.set(d.id.name, init);
      }
    }
  }
  return fns;
}
function topLevelNames(program) {
  const names = new Set;
  for (const stmt of program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "ImportDeclaration") {
      for (const spec of decl.specifiers)
        names.add(spec.local.name);
    } else if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations)
        collectPatternNames(d.id, names);
    } else if ((decl?.type === "FunctionDeclaration" || decl?.type === "ClassDeclaration") && decl.id !== null) {
      names.add(decl.id.name);
    }
  }
  return names;
}
function checkBrowserGlobals(program, code, filename, warnings) {
  if (!MENTIONS_RE.test(code))
    return;
  const shadowing = topLevelNames(program);
  const helpers = topLevelFunctions(program);
  const eagerCallbacks = new WeakSet;
  const calleeStarts = new Set;
  const guards = [];
  walk(program, (node) => {
    if (node.type === "CallExpression") {
      const callee = unwrapTsExpr(node.callee);
      if (callee.type === "Identifier")
        calleeStarts.add(callee.start);
      else if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && EAGER_CALLBACK_METHODS.has(callee.property.name) && node.arguments[0] !== undefined)
        eagerCallbacks.add(unwrapTsExpr(node.arguments[0]));
    } else if (node.type === "UnaryExpression" && node.operator === "typeof" && node.argument.type === "Identifier" && BROWSER_GLOBALS.has(node.argument.name)) {
      guards.push(node.start);
    }
  });
  const isGuarded = (node) => guards.some((start) => start >= node.start && start < node.end);
  const readsOf = new Map;
  const collect = (root) => {
    const known = readsOf.get(root);
    if (known !== undefined)
      return known;
    const reads = [];
    readsOf.set(root, reads);
    if (isGuarded(root))
      return reads;
    walkScoped(root, {
      onFunction: (fn) => !eagerCallbacks.has(fn),
      onIdentifier: (id) => {
        if (BROWSER_GLOBALS.has(id.name) && !shadowing.has(id.name)) {
          reads.push({ name: id.name, start: id.start });
          return;
        }
        const helper = calleeStarts.has(id.start) ? helpers.get(id.name) : undefined;
        if (helper !== undefined)
          reads.push(...collect(helper));
      }
    });
    return reads;
  };
  const reported = new Set;
  const report = (reads, when) => {
    for (const read of reads) {
      if (reported.has(read.start))
        continue;
      reported.add(read.start);
      warnings.push({ start: read.start, message: `prunelle compiler: \`${read.name}\` read ${when} in ${filename}: the server has no \`${read.name}\`, so it throws; read it in onMount() or an event handler, or check \`typeof ${read.name} !== 'undefined'\` first.` });
    }
  };
  report(collect(program), "when the module loads");
  for (const [name, fn] of helpers) {
    if (containsJsx(fn))
      report(collect(fn), `while <${name}> renders`);
  }
}

// packages/prunelle/src/compiler/cacheability.ts
var import_oxc_parser3 = require("oxc-parser");

// packages/prunelle/src/server/route-cache.ts
var DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
var DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;
var UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000
};
function parseCacheDuration(value, allowZero = false) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
      return;
    return Math.round(value * 1000);
  }
  if (typeof value !== "string")
    return;
  const match = DURATION_RE.exec(value.trim());
  if (match === null)
    return;
  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2].toLowerCase()];
  if (!Number.isFinite(amount) || unit === undefined)
    return;
  const ms = Math.round(amount * unit);
  if (!Number.isFinite(ms) || (allowZero ? ms < 0 : ms <= 0))
    return;
  return ms;
}
function buildRouteCacheSpec(maxAgeMs, swrMs = maxAgeMs) {
  const maxAgeSec = Math.max(1, Math.round(maxAgeMs / 1000));
  const swrSec = swrMs === 0 ? 0 : Math.max(1, Math.round(swrMs / 1000));
  return {
    maxAgeMs,
    swrMs,
    cacheControl: `public, s-maxage=${maxAgeSec}, stale-while-revalidate=${swrSec}`
  };
}

// packages/prunelle/src/compiler/cacheability.ts
var CACHE_HELP = "write a duration such as '30s', '5m', '1h', '1d', a positive number of seconds, or { maxAge: '1h', staleWhileRevalidate?: '1d' }";
var DYNAMIC_PROPS = new Set(["params", "url", "locals", "cookies", "headers", "request", "consent", "ip"]);
var PRIVATE_CTX_PROPS = new Set(["cookies", "locals", "consent"]);
var PRIVATE_PAGE_PROPS = new Set(["locals", "cookies", "consent"]);
var PRIVATE_SERVER_IMPORTS = new Set(["getActionError", "currentRequest"]);
var DYNAMIC_TAGS = new Set(["ConsentGate", "Suspense"]);
var PRIVATE_TAGS = new Set(["ConsentGate"]);
var CLIENT_CALLBACK_CALLEES = new Set(["onMount", "effect", "onCleanup"]);
var TS_EXPR_WRAPPERS = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
function staticStringOrNumber(node) {
  const inner = unwrapTsExpr(node);
  if (inner.type === "TemplateLiteral" && inner.expressions.length === 0 && inner.quasis.length === 1)
    return { ok: true, value: inner.quasis[0].value.cooked ?? inner.quasis[0].value.raw };
  const lit = staticLiteral(inner);
  if (!lit.ok)
    return { ok: false, isLiteral: false };
  return typeof lit.value === "string" || typeof lit.value === "number" ? { ok: true, value: lit.value } : { ok: false, isLiteral: true };
}
function propKeyName(prop) {
  if (prop.type !== "Property")
    return;
  if (!prop.computed && prop.key.type === "Identifier")
    return prop.key.name;
  return prop.key.type === "Literal" && typeof prop.key.value === "string" ? prop.key.value : undefined;
}
function parseCacheObjectNode(node) {
  let maxAgeMs;
  let swrMs;
  let swrKeyCount = 0;
  for (const prop of node.properties) {
    if (prop.type !== "Property" || prop.kind !== "init")
      return { problem: `cache object must use static properties: ${CACHE_HELP}` };
    const key = propKeyName(prop);
    if (key === undefined)
      return { problem: `cache object has a dynamic key: ${CACHE_HELP}` };
    if (key !== "maxAge" && key !== "staleWhileRevalidate" && key !== "swr")
      return { problem: `unknown cache option "${key}": ${CACHE_HELP}` };
    const parsed = staticStringOrNumber(prop.value);
    if (!parsed.ok)
      return { problem: parsed.isLiteral ? `cache.${key} must be a duration string or number of seconds: ${CACHE_HELP}` : `cache.${key} set at runtime: ${CACHE_HELP}` };
    const ms = parseCacheDuration(parsed.value, key !== "maxAge");
    if (ms === undefined)
      return { problem: `invalid cache.${key} value ${JSON.stringify(parsed.value)}: ${CACHE_HELP}` };
    if (key === "maxAge") {
      maxAgeMs = ms;
    } else {
      swrKeyCount++;
      swrMs = ms;
    }
  }
  if (maxAgeMs === undefined)
    return { problem: `cache object is missing "maxAge": ${CACHE_HELP}` };
  if (swrKeyCount > 1)
    return { problem: `specify either "staleWhileRevalidate" or "swr", not both: ${CACHE_HELP}` };
  return { spec: buildRouteCacheSpec(maxAgeMs, swrMs ?? maxAgeMs) };
}
function parseCacheExport(program) {
  const localInits = new Map;
  let exportedLocal;
  let exportInit;
  let offset = 0;
  let hasExport = false;
  for (const stmt of program.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier" && d.init !== null)
          localInits.set(d.id.name, d.init);
      }
      continue;
    }
    if (stmt.type !== "ExportNamedDeclaration" || stmt.exportKind === "type")
      continue;
    if (stmt.declaration?.type === "VariableDeclaration") {
      for (const d of stmt.declaration.declarations) {
        if (d.id.type === "Identifier" && d.id.name === "cache") {
          hasExport = true;
          offset = d.start;
          exportInit = d.init ?? undefined;
        }
      }
    } else if (stmt.declaration !== null && "id" in stmt.declaration && stmt.declaration.id?.type === "Identifier" && stmt.declaration.id.name === "cache") {
      return { hasExport: true, offset: stmt.declaration.start, problem: `invalid cache export: ${CACHE_HELP}` };
    }
    for (const spec of stmt.specifiers) {
      const exp = spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
      if (exp === "cache" && spec.exportKind !== "type") {
        hasExport = true;
        offset = spec.start;
        if (stmt.source === null && spec.local.type === "Identifier")
          exportedLocal = spec.local.name;
      }
    }
  }
  if (!hasExport)
    return { hasExport: false, offset: 0 };
  const init = exportInit ?? (exportedLocal !== undefined ? localInits.get(exportedLocal) : undefined);
  if (init === undefined)
    return { hasExport: true, offset, problem: `cache set at runtime: ${CACHE_HELP}` };
  const inner = unwrapTsExpr(init);
  if (inner.type === "ObjectExpression") {
    const res = parseCacheObjectNode(inner);
    return "spec" in res ? { hasExport: true, offset, spec: res.spec } : { hasExport: true, offset, problem: res.problem };
  }
  const scalar = staticStringOrNumber(inner);
  if (!scalar.ok)
    return { hasExport: true, offset, problem: scalar.isLiteral ? `invalid cache export: ${CACHE_HELP}` : `cache set at runtime: ${CACHE_HELP}` };
  const ms = parseCacheDuration(scalar.value);
  if (ms === undefined)
    return { hasExport: true, offset, problem: `invalid cache duration ${JSON.stringify(scalar.value)}: ${CACHE_HELP}` };
  return { hasExport: true, offset, spec: buildRouteCacheSpec(ms) };
}

// packages/prunelle/src/compiler/data-keys.ts
var import_oxc_parser4 = require("oxc-parser");
function staticPropKey(prop) {
  if (prop.type !== "Property")
    return;
  if (!prop.computed && prop.key.type === "Identifier")
    return prop.key.name;
  if (prop.key.type === "Literal" && typeof prop.key.value === "string")
    return prop.key.value;
  return;
}
function extractObjectPatternKeys(pat) {
  if (pat.type !== "ObjectPattern")
    return;
  const keys = [];
  for (const prop of pat.properties) {
    if (prop.type === "RestElement")
      return;
    const k = staticPropKey(prop);
    if (k === undefined)
      return;
    keys.push(k);
  }
  return keys;
}
function memberKeyName(node) {
  if (node.type !== "MemberExpression")
    return;
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string")
    return node.property.value;
  return;
}
function unwrapParamPattern(param) {
  return param.type === "AssignmentPattern" ? param.left : param;
}
function resolveDefaultFunction(program, defaultLocal, localInits) {
  const localFns = new Map;
  for (const stmt of program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id !== null)
      localFns.set(stmt.id.name, stmt);
    else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "FunctionDeclaration" && stmt.declaration.id !== null)
      localFns.set(stmt.declaration.id.name, stmt.declaration);
  }
  const unwrapTarget = (node, depth = 0) => {
    if (node === undefined || depth > 4)
      return;
    const inner = unwrapTsExpr(node);
    if (inner.type === "FunctionDeclaration" || inner.type === "FunctionExpression" || inner.type === "ArrowFunctionExpression")
      return inner;
    if (inner.type === "Identifier")
      return localFns.get(inner.name) ?? unwrapTarget(localInits.get(inner.name), depth + 1);
    return;
  };
  for (const stmt of program.body) {
    if (stmt.type === "ExportDefaultDeclaration")
      return unwrapTarget(stmt.declaration);
  }
  if (defaultLocal !== undefined)
    return localFns.get(defaultLocal) ?? unwrapTarget(localInits.get(defaultLocal));
  return;
}
var TS_EXPR_WRAPPERS2 = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression"
]);
function analyzeDefaultDataKeys(program, defaultLocal, localInits) {
  const fn = resolveDefaultFunction(program, defaultLocal, localInits);
  if (fn === undefined || fn.body === null)
    return;
  if (fn.params.length === 0)
    return [];
  const firstParam = unwrapParamPattern(fn.params[0]);
  const keys = new Set;
  let escaped = false;
  let dataVar;
  let propsVar;
  if (firstParam.type === "ObjectPattern") {
    let dataProp;
    for (const prop of firstParam.properties) {
      if (prop.type === "RestElement")
        return;
      const key = staticPropKey(prop);
      if (key === undefined)
        return;
      if (key === "data")
        dataProp = prop;
    }
    if (dataProp === undefined || dataProp.type !== "Property")
      return [];
    const binding = unwrapParamPattern(dataProp.value);
    if (binding.type === "ObjectPattern") {
      const nested = extractObjectPatternKeys(binding);
      if (nested === undefined)
        return;
      return [...new Set(nested)].sort();
    }
    if (binding.type !== "Identifier")
      return;
    dataVar = binding.name;
  } else if (firstParam.type === "Identifier") {
    propsVar = firstParam.name;
  } else {
    return;
  }
  const ancestors = [];
  const walkWithParents = (node) => {
    if (escaped || node === null || typeof node !== "object")
      return;
    if (Array.isArray(node)) {
      for (let i = 0;i < node.length; i++)
        walkWithParents(node[i]);
      return;
    }
    const ast = node;
    const type = ast.type;
    if (typeof type !== "string")
      return;
    if (type.startsWith("TS")) {
      if (TS_EXPR_WRAPPERS2.has(type))
        walkWithParents(ast.expression);
      return;
    }
    if (ast !== fn && (type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression")) {
      const innerFn = ast;
      const shadowed = new Set;
      if (innerFn.type !== "ArrowFunctionExpression" && innerFn.id !== null)
        shadowed.add(innerFn.id.name);
      let isShadowed = dataVar !== undefined && shadowed.has(dataVar) || propsVar !== undefined && shadowed.has(propsVar);
      for (const p of innerFn.params) {
        if (isShadowed)
          return;
        walkPatternDefaults(p);
        collectPatternNames(p, shadowed);
        if (dataVar !== undefined && shadowed.has(dataVar) || propsVar !== undefined && shadowed.has(propsVar))
          isShadowed = true;
      }
      if (!isShadowed && innerFn.body !== null)
        walkWithParents(innerFn.body);
      return;
    }
    if (type === "Identifier") {
      const parent = ancestors[ancestors.length - 1];
      const grand = ancestors[ancestors.length - 2];
      const isNonRef = parent !== undefined && (parent.type === "MemberExpression" && !parent.computed && parent.property === ast || parent.type === "Property" && !parent.computed && parent.key === ast && !parent.shorthand || parent.type === "VariableDeclarator" && parent.id === ast || parent.type === "LabeledStatement" && parent.label === ast || parent.type === "FunctionDeclaration" && parent.id === ast || parent.type === "FunctionExpression" && parent.id === ast);
      if (!isNonRef && dataVar !== undefined && ast.name === dataVar) {
        if (parent?.type === "MemberExpression" && parent.object === ast) {
          const k = memberKeyName(parent);
          if (k === undefined)
            escaped = true;
          else
            keys.add(k);
        } else if (parent?.type === "VariableDeclarator" && parent.init === ast) {
          const nested = extractObjectPatternKeys(parent.id);
          if (nested === undefined)
            escaped = true;
          else
            for (const k of nested)
              keys.add(k);
        } else {
          escaped = true;
        }
      } else if (!isNonRef && propsVar !== undefined && ast.name === propsVar) {
        if (parent?.type === "MemberExpression" && parent.object === ast) {
          const propName = memberKeyName(parent);
          if (propName === undefined) {
            escaped = true;
          } else if (propName === "data") {
            const holder = grand?.type === "ChainExpression" ? ancestors[ancestors.length - 3] : grand;
            const target = grand?.type === "ChainExpression" ? grand : parent;
            if (holder?.type === "MemberExpression" && holder.object === target) {
              const k = memberKeyName(holder);
              if (k === undefined)
                escaped = true;
              else
                keys.add(k);
            } else if (holder?.type === "VariableDeclarator" && holder.init === target) {
              const nested = extractObjectPatternKeys(holder.id);
              if (nested === undefined)
                escaped = true;
              else
                for (const k of nested)
                  keys.add(k);
            } else {
              escaped = true;
            }
          }
        } else {
          escaped = true;
        }
      }
    }
    ancestors.push(ast);
    const childKeys = import_oxc_parser4.visitorKeys[type];
    if (childKeys !== undefined) {
      const rec = ast;
      for (let i = 0;i < childKeys.length; i++) {
        const val = rec[childKeys[i]];
        if (val !== null && typeof val === "object")
          walkWithParents(val);
      }
    }
    ancestors.pop();
  };
  const walkPatternDefaults = (pattern) => {
    if (escaped || pattern === null || pattern === undefined)
      return;
    switch (pattern.type) {
      case "AssignmentPattern":
        walkPatternDefaults(pattern.left);
        walkWithParents(pattern.right);
        return;
      case "RestElement":
        walkPatternDefaults(pattern.argument);
        return;
      case "TSParameterProperty":
        walkPatternDefaults(pattern.parameter);
        return;
      case "ArrayPattern":
        for (const el of pattern.elements)
          walkPatternDefaults(el);
        return;
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          if (prop.type === "RestElement") {
            walkPatternDefaults(prop.argument);
          } else {
            if (prop.computed)
              walkWithParents(prop.key);
            walkPatternDefaults(prop.value);
          }
        }
    }
  };
  for (const p of fn.params)
    walkPatternDefaults(p);
  walkWithParents(fn.body);
  return escaped ? undefined : [...keys].sort();
}

// packages/prunelle/src/compiler/compliance.ts
var import_oxc_parser5 = require("oxc-parser");

// packages/prunelle/src/compiler/compliance-rgaa.ts
var RGAA_JSX_RULES = [
  "rgaa/img-alt",
  "rgaa/form-label",
  "rgaa/accessible-name",
  "rgaa/duplicate-id",
  "rgaa/positive-tabindex",
  "rgaa/nested-control",
  "rgaa/link-as-button",
  "rgaa/unknown-role",
  "rgaa/unknown-aria",
  "rgaa/invalid-aria-value",
  "rgaa/skipped-heading",
  "rgaa/table-without-header",
  "rgaa/fieldset-without-legend",
  "rgaa/click-without-key",
  "rgaa/autofocus",
  "rgaa/meta-refresh"
];
var NON_LABELLED_INPUT_TYPES = new Set(["hidden", "submit", "reset", "button", "image"]);
var INTERACTIVE_ANCESTORS = new Set(["a", "button", "summary"]);
var INTERACTIVE_DESCENDANTS = new Set(["a", "button", "input", "select", "textarea", "summary"]);
var NATIVE_CLICKABLE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "label", "option", "dialog", "area"]);
var TABLE_STRUCTURAL_TAGS = new Set(["thead", "tbody", "tfoot", "tr"]);
var HEADING_LEVELS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
var PRESENTATIONAL_ROLES = new Set(["presentation", "none"]);
var INT_RE = /^-?\d+$/;
var NUM_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;
var TABINDEX_NUM_RE = /^[+-]?\d+(?:\.\d+)?$/;
var VALID_ARIA_ROLES = new Set(("alert alertdialog application article associationlist associationlistitemkey associationlistitemvalue " + "banner blockquote button caption cell checkbox code columnheader combobox comment complementary contentinfo " + "definition deletion dialog directory document emphasis feed figure form generic " + "graphics-document graphics-object graphics-symbol grid gridcell group heading image img insertion " + "link list listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio " + "meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader " + "scrollbar search searchbox separator slider spinbutton status strong subscript suggestion superscript switch " + "tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem").split(" "));
var VALID_ARIA_ATTRS = new Set(("aria-activedescendant aria-atomic aria-autocomplete aria-braillelabel aria-brailleroledescription " + "aria-busy aria-checked aria-colcount aria-colindex aria-colindextext aria-colspan aria-controls " + "aria-current aria-describedby aria-description aria-details aria-disabled aria-dropeffect " + "aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid " + "aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-modal aria-multiline " + "aria-multiselectable aria-orientation aria-owns aria-placeholder aria-posinset aria-pressed " + "aria-readonly aria-relevant aria-required aria-roledescription aria-rowcount aria-rowindex " + "aria-rowindextext aria-rowspan aria-selected aria-setsize aria-sort aria-valuemax aria-valuemin " + "aria-valuenow aria-valuetext").split(" "));
var ARIA_BOOL_ATTRS = new Set(("aria-atomic aria-busy aria-disabled aria-expanded aria-grabbed aria-hidden " + "aria-modal aria-multiline aria-multiselectable aria-readonly aria-required aria-selected").split(" "));
var ARIA_TRISTATE_ATTRS = new Set(["aria-checked", "aria-pressed"]);
var ARIA_INT_ATTRS = new Set(("aria-level aria-posinset aria-setsize aria-colcount aria-rowcount " + "aria-colindex aria-rowindex aria-colspan aria-rowspan").split(" "));
var ARIA_NUM_ATTRS = new Set(["aria-valuemin", "aria-valuemax", "aria-valuenow"]);
var ARIA_RELEVANT_TOKENS = new Set(["additions", "removals", "text", "all"]);
var ARIA_ENUM_ATTRS = {
  "aria-live": new Set(["off", "polite", "assertive"]),
  "aria-orientation": new Set(["horizontal", "vertical"]),
  "aria-sort": new Set(["none", "ascending", "descending", "other"]),
  "aria-current": new Set(["page", "step", "location", "date", "time", "true", "false"]),
  "aria-haspopup": new Set(["false", "true", "menu", "listbox", "tree", "grid", "dialog"]),
  "aria-invalid": new Set(["grammar", "false", "spelling", "true"]),
  "aria-autocomplete": new Set(["inline", "list", "both", "none"])
};
function createRgaaScope() {
  return { seenIds: new Set, lastHeading: 0 };
}
function cloneRgaaScope(scope) {
  return { seenIds: new Set(scope.seenIds), lastHeading: scope.lastHeading };
}
function mergeRgaaScope(target, branch) {
  for (const id of branch.seenIds)
    target.seenIds.add(id);
  if (branch.lastHeading > target.lastHeading)
    target.lastHeading = branch.lastHeading;
}
function findAttr(attributes, name) {
  for (const attr of attributes) {
    if (attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === name)
      return attr;
  }
  return;
}
function findAttrLower(attributes, lowerName) {
  for (const attr of attributes) {
    if (attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name.toLowerCase() === lowerName)
      return attr;
  }
  return;
}
function hasSpread(attributes) {
  return attributes.some((a) => a.type === "JSXSpreadAttribute");
}
function staticStringValueOf(value) {
  if (value === null)
    return;
  if (value.type === "Literal" && typeof value.value === "string")
    return value.value;
  if (value.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression") {
    const expr = unwrapTsExpr(value.expression);
    if (expr.type === "Literal" && typeof expr.value === "string")
      return expr.value;
    if (expr.type === "TemplateLiteral" && expr.expressions.length === 0)
      return expr.quasis[0]?.value.cooked ?? undefined;
  }
  return;
}
function attrTargetKey(attr) {
  if (attr === undefined || attr.value === null)
    return;
  const str = staticStringValueOf(attr.value);
  if (str !== undefined && str.trim() !== "")
    return `s:${str}`;
  if (attr.value.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression") {
    const expr = unwrapTsExpr(attr.value.expression);
    if (expr.type === "Identifier")
      return `i:${expr.name}`;
  }
  return;
}
function hasNonEmptyAttr(attributes, name) {
  const attr = findAttr(attributes, name);
  if (attr === undefined || attr.value === null)
    return false;
  const str = staticStringValueOf(attr.value);
  if (str !== undefined)
    return str.trim() !== "";
  if (attr.value.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression") {
    const expr = unwrapParens(attr.value.expression);
    if (expr.type === "Literal" && (expr.value === null || expr.value === false || expr.value === ""))
      return false;
    if (expr.type === "Identifier" && expr.name === "undefined")
      return false;
    return true;
  }
  return false;
}
function isExplicitlyFalsyExpr(value) {
  if (value === null || value.type !== "JSXExpressionContainer" || value.expression.type === "JSXEmptyExpression")
    return false;
  const expr = unwrapTsExpr(value.expression);
  if (expr.type === "Literal" && (expr.value === false || expr.value === null))
    return true;
  return expr.type === "Identifier" && expr.name === "undefined";
}
function hasLabelAttr(attributes) {
  return hasNonEmptyAttr(attributes, "aria-label") || hasNonEmptyAttr(attributes, "aria-labelledby") || hasNonEmptyAttr(attributes, "title");
}
function isAriaHidden(attributes) {
  const attr = findAttr(attributes, "aria-hidden");
  if (attr === undefined)
    return false;
  if (attr.value === null)
    return true;
  if (attr.value.type === "Literal")
    return attr.value.value === "true";
  if (attr.value.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression") {
    const expr = unwrapParens(attr.value.expression);
    return expr.type === "Literal" && (expr.value === true || expr.value === "true");
  }
  return false;
}
function isPresentational(attributes) {
  const raw = staticStringValueOf(findAttr(attributes, "role")?.value ?? null);
  return raw !== undefined && raw.trim().split(/\s+/).some((token) => PRESENTATIONAL_ROLES.has(token));
}
function hasMeaningfulExpression(expr) {
  const inner = unwrapParens(expr);
  if (inner.type === "Literal")
    return typeof inner.value === "string" ? inner.value.trim() !== "" : typeof inner.value === "number";
  return !(inner.type === "Identifier" && inner.name === "undefined");
}
function hasAccessibleName(children) {
  for (const child of children) {
    if (child.type === "JSXText") {
      if (cleanJsxText(child.value).trim() !== "")
        return true;
    } else if (child.type === "JSXExpressionContainer") {
      if (child.expression.type !== "JSXEmptyExpression" && hasMeaningfulExpression(child.expression))
        return true;
    } else if (child.type === "JSXFragment") {
      if (hasAccessibleName(child.children))
        return true;
    } else if (child.type === "JSXElement") {
      const attrs = child.openingElement.attributes;
      if (isAriaHidden(attrs))
        continue;
      const tag = jsxTagName(child.openingElement.name);
      if (hasSpread(attrs) || hasLabelAttr(attrs))
        return true;
      if (tag === "img") {
        if (hasNonEmptyAttr(attrs, "alt"))
          return true;
        continue;
      }
      if (tag === "svg") {
        if (child.children.some((c) => c.type === "JSXElement" && jsxTagName(c.openingElement.name) === "title" && hasAccessibleName(c.children)))
          return true;
        continue;
      }
      if (isComponentTag(tag)) {
        if (hasNonEmptyAttr(attrs, "label") || hasAccessibleName(child.children))
          return true;
        continue;
      }
      if (hasAccessibleName(child.children))
        return true;
    }
  }
  return false;
}
function extractStaticAttrValue(attr) {
  if (attr.value === null)
    return { kind: "bool", value: true };
  if (attr.value.type === "Literal" && typeof attr.value.value === "string")
    return { kind: "string", value: attr.value.value };
  if (attr.value.type !== "JSXExpressionContainer" || attr.value.expression.type === "JSXEmptyExpression")
    return;
  const expr = unwrapTsExpr(attr.value.expression);
  if (expr.type === "Identifier" && expr.name === "undefined")
    return;
  if (expr.type === "TemplateLiteral" && expr.expressions.length === 0)
    return { kind: "string", value: expr.quasis[0]?.value.cooked ?? "" };
  if (expr.type === "UnaryExpression" && expr.operator === "+" && expr.argument.type === "Literal" && typeof expr.argument.value === "number")
    return { kind: "number", value: expr.argument.value };
  const lit = staticLiteral(expr);
  if (!lit.ok || lit.value === null)
    return;
  if (typeof lit.value === "boolean")
    return { kind: "bool", value: lit.value };
  if (typeof lit.value === "number")
    return { kind: "number", value: lit.value };
  return { kind: "string", value: lit.value };
}
function validateAriaValue(name, val) {
  if (ARIA_BOOL_ATTRS.has(name))
    return val.kind === "bool" || val.kind === "string" && (val.value === "true" || val.value === "false") ? undefined : 'expected "true" or "false"';
  if (ARIA_TRISTATE_ATTRS.has(name))
    return val.kind === "bool" || val.kind === "string" && (val.value === "true" || val.value === "false" || val.value === "mixed") ? undefined : 'expected "true", "false", or "mixed"';
  const enumSet = ARIA_ENUM_ATTRS[name];
  if (enumSet !== undefined) {
    const token = val.kind === "bool" ? String(val.value) : val.kind === "string" ? val.value : undefined;
    return token !== undefined && enumSet.has(token) ? undefined : `expected one of ${[...enumSet].join(", ")}`;
  }
  if (name === "aria-relevant") {
    const tokens = val.kind === "string" ? val.value.trim().split(/\s+/).filter(Boolean) : [];
    return tokens.length > 0 && tokens.every((t) => ARIA_RELEVANT_TOKENS.has(t)) ? undefined : "expected space-separated tokens from additions, removals, text, all";
  }
  if (ARIA_INT_ATTRS.has(name))
    return val.kind === "number" && Number.isInteger(val.value) || val.kind === "string" && INT_RE.test(val.value.trim()) ? undefined : "expected an integer";
  if (ARIA_NUM_ATTRS.has(name))
    return val.kind === "number" && Number.isFinite(val.value) || val.kind === "string" && NUM_RE.test(val.value.trim()) ? undefined : "expected a number";
  return;
}
function emitWarning(ctx, rule, elementStart, message, attrStart) {
  if (!ctx.isIgnored(rule, elementStart, attrStart))
    ctx.warnings.push({ rule, start: attrStart ?? elementStart, message });
}
function checkRoleAndAria(element, tag, ctx) {
  const attrs = element.openingElement.attributes;
  const roleAttr = findAttr(attrs, "role");
  if (roleAttr !== undefined) {
    const raw = staticStringValueOf(roleAttr.value);
    if (raw !== undefined) {
      const tokens = raw.trim().split(/\s+/).filter(Boolean);
      const invalid = tokens.filter((t) => !VALID_ARIA_ROLES.has(t));
      if (tokens.length === 0 || invalid.length > 0) {
        const detail = tokens.length === 0 ? "an empty role" : `unknown WAI-ARIA role "${invalid[0]}"`;
        emitWarning(ctx, "rgaa/unknown-role", element.start, `[rgaa/unknown-role] <${tag} role="${raw}"> in ${ctx.filename} uses ${detail}: use a valid WAI-ARIA role or remove the attribute.`, roleAttr.start);
      }
    }
  }
  for (const attr of attrs) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier" || !attr.name.name.startsWith("aria-"))
      continue;
    const name = attr.name.name;
    if (!VALID_ARIA_ATTRS.has(name)) {
      emitWarning(ctx, "rgaa/unknown-aria", element.start, `[rgaa/unknown-aria] <${tag} ${name}> in ${ctx.filename} is not a valid WAI-ARIA attribute: check the spelling or remove it.`, attr.start);
      continue;
    }
    const val = extractStaticAttrValue(attr);
    if (val === undefined)
      continue;
    const err = validateAriaValue(name, val);
    if (err !== undefined) {
      const shown = val.kind === "string" ? `"${val.value}"` : String(val.value);
      emitWarning(ctx, "rgaa/invalid-aria-value", element.start, `[rgaa/invalid-aria-value] <${tag} ${name}=${shown}> in ${ctx.filename} has an invalid value (${err}).`, attr.start);
    }
  }
}
function checkExprForChild(expr, checkElement, checkFragment) {
  const inner = unwrapTsExpr(expr);
  if (inner.type === "Literal" || inner.type === "Identifier" && inner.name === "undefined")
    return false;
  if (inner.type === "JSXElement")
    return checkElement(inner);
  if (inner.type === "JSXFragment")
    return checkFragment(inner.children);
  if (inner.type === "LogicalExpression") {
    return inner.operator === "&&" ? checkExprForChild(inner.right, checkElement, checkFragment) : checkExprForChild(inner.left, checkElement, checkFragment) || checkExprForChild(inner.right, checkElement, checkFragment);
  }
  if (inner.type === "ConditionalExpression")
    return checkExprForChild(inner.consequent, checkElement, checkFragment) || checkExprForChild(inner.alternate, checkElement, checkFragment);
  return true;
}
function tableMayHaveHeader(children) {
  const checkEl = (el) => {
    const tag = jsxTagName(el.openingElement.name);
    if (tag === "th" || isComponentTag(tag))
      return true;
    return TABLE_STRUCTURAL_TAGS.has(tag) && tableMayHaveHeader(el.children);
  };
  for (const child of children) {
    if (child.type === "JSXElement" && checkEl(child))
      return true;
    if (child.type === "JSXFragment" && tableMayHaveHeader(child.children))
      return true;
    if (child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression" && checkExprForChild(child.expression, checkEl, tableMayHaveHeader))
      return true;
  }
  return false;
}
function fieldsetMayHaveLegend(children, isDirect) {
  const checkEl = (el) => {
    const tag = jsxTagName(el.openingElement.name);
    if (tag === "legend")
      return true;
    if (tag === "fieldset")
      return false;
    return isDirect && isComponentTag(tag) || fieldsetMayHaveLegend(el.children, false);
  };
  for (const child of children) {
    if (child.type === "JSXElement" && checkEl(child))
      return true;
    if (child.type === "JSXFragment" && fieldsetMayHaveLegend(child.children, isDirect))
      return true;
    if (isDirect && child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression" && checkExprForChild(child.expression, checkEl, (cs) => fieldsetMayHaveLegend(cs, true)))
      return true;
  }
  return false;
}
function checkFocusAndInteraction(element, tag, spread, ctx) {
  const attrs = element.openingElement.attributes;
  const tabAttr = findAttrLower(attrs, "tabindex");
  if (tabAttr !== undefined) {
    const val = extractStaticAttrValue(tabAttr);
    const num = val?.kind === "number" ? val.value : val?.kind === "string" && TABINDEX_NUM_RE.test(val.value.trim()) ? Number(val.value.trim()) : undefined;
    if (num !== undefined && Number.isFinite(num) && num > 0) {
      const attrName = tabAttr.name.type === "JSXIdentifier" ? tabAttr.name.name : "tabindex";
      emitWarning(ctx, "rgaa/positive-tabindex", element.start, `[rgaa/positive-tabindex] <${tag} ${attrName}={${num}}> in ${ctx.filename} uses a positive tabindex: use 0, -1, or reorder the DOM to preserve natural keyboard order.`, tabAttr.start);
    }
  }
  const autoFocusAttr = findAttrLower(attrs, "autofocus");
  if (autoFocusAttr !== undefined && !isExplicitlyFalsyExpr(autoFocusAttr.value)) {
    const attrName = autoFocusAttr.name.type === "JSXIdentifier" ? autoFocusAttr.name.name : "autofocus";
    emitWarning(ctx, "rgaa/autofocus", element.start, `[rgaa/autofocus] <${tag} ${attrName}> in ${ctx.filename} steals focus on load and can disorient keyboard and screen-reader users: remove ${attrName} or manage focus explicitly.`, autoFocusAttr.start);
  }
  if (ctx.interactiveAncestor !== undefined && INTERACTIVE_DESCENDANTS.has(tag)) {
    const inputType = tag === "input" ? staticStringValueOf(findAttr(attrs, "type")?.value ?? null)?.toLowerCase() : undefined;
    if (inputType !== "hidden")
      emitWarning(ctx, "rgaa/nested-control", element.start, `[rgaa/nested-control] <${tag}> in ${ctx.filename} is nested inside <${ctx.interactiveAncestor}>: interactive controls must not be nested; place them as siblings.`);
  }
  const onClickAttr = findAttr(attrs, "onClick");
  const hasClick = onClickAttr !== undefined && !isExplicitlyFalsyExpr(onClickAttr.value);
  if (tag === "a" && !spread && hasClick && !hasNonEmptyAttr(attrs, "href"))
    emitWarning(ctx, "rgaa/link-as-button", element.start, `[rgaa/link-as-button] <a> with onClick and no href in ${ctx.filename}: use <button type="button"> for actions, or add a valid href for navigation.`);
  if (hasClick && !spread && !NATIVE_CLICKABLE_TAGS.has(tag) && !isPresentational(attrs)) {
    const hasKey = findAttr(attrs, "onKeyDown") !== undefined || findAttr(attrs, "onKeyUp") !== undefined || findAttr(attrs, "onKeyPress") !== undefined;
    if (!hasKey)
      emitWarning(ctx, "rgaa/click-without-key", element.start, `[rgaa/click-without-key] <${tag} onClick={...}> in ${ctx.filename} is not keyboard-accessible: use <button type="button">, or add onKeyDown/onKeyUp with an appropriate role and tabIndex.`, onClickAttr.start);
  }
}
function checkStructureAndIdentity(element, tag, spread, ctx) {
  const attrs = element.openingElement.attributes;
  const idAttr = findAttr(attrs, "id");
  const id = idAttr !== undefined ? staticStringValueOf(idAttr.value) : undefined;
  if (id !== undefined && id !== "") {
    if (ctx.scope.seenIds.has(id))
      emitWarning(ctx, "rgaa/duplicate-id", element.start, `[rgaa/duplicate-id] Duplicate id="${id}" on <${tag}> in ${ctx.filename}: every id in a document must be unique.`, idAttr.start);
    else
      ctx.scope.seenIds.add(id);
  }
  const headingLevel = HEADING_LEVELS[tag];
  if (headingLevel !== undefined) {
    if (ctx.scope.lastHeading > 0 && headingLevel > ctx.scope.lastHeading + 1)
      emitWarning(ctx, "rgaa/skipped-heading", element.start, `[rgaa/skipped-heading] <h${headingLevel}> in ${ctx.filename} skips heading level(s) after <h${ctx.scope.lastHeading}>: use <h${ctx.scope.lastHeading + 1}> to keep the heading hierarchy continuous.`);
    ctx.scope.lastHeading = headingLevel;
  }
  if (tag === "table" && !isPresentational(attrs) && !(element.children.length === 0 && spread) && !tableMayHaveHeader(element.children))
    emitWarning(ctx, "rgaa/table-without-header", element.start, `[rgaa/table-without-header] <table> in ${ctx.filename} has no <th> header cell: add <th> headers or role="presentation" if used for layout.`);
  if (tag === "fieldset" && !(element.children.length === 0 && spread) && !fieldsetMayHaveLegend(element.children, true))
    emitWarning(ctx, "rgaa/fieldset-without-legend", element.start, `[rgaa/fieldset-without-legend] <fieldset> in ${ctx.filename} has no <legend>: add a <legend> child to label the form group.`);
  if (tag === "meta") {
    const httpEquivAttr = findAttrLower(attrs, "http-equiv") ?? findAttrLower(attrs, "httpequiv");
    if (httpEquivAttr !== undefined && staticStringValueOf(httpEquivAttr.value)?.trim().toLowerCase() === "refresh")
      emitWarning(ctx, "rgaa/meta-refresh", element.start, `[rgaa/meta-refresh] <meta http-equiv="refresh"> in ${ctx.filename} redirects or reloads without user control: use an HTTP redirect or an explicit user action.`, httpEquivAttr.start);
  }
}
function checkRgaaElement(element, tag, ctx) {
  const attrs = element.openingElement.attributes;
  const spread = hasSpread(attrs);
  if (tag === "img" && !spread && findAttr(attrs, "alt") === undefined)
    emitWarning(ctx, "rgaa/img-alt", element.start, `[rgaa/img-alt] <img> in ${ctx.filename} is missing an alt attribute: add alt="description" or alt="" for decorative images.`);
  if ((tag === "input" || tag === "select" || tag === "textarea") && !spread && !ctx.inLabel && !hasLabelAttr(attrs)) {
    const inputType = tag === "input" ? staticStringValueOf(findAttr(attrs, "type")?.value ?? null)?.toLowerCase() : undefined;
    const idKey = attrTargetKey(findAttr(attrs, "id"));
    const linked = idKey !== undefined && ctx.labelTargets.has(idKey);
    if ((inputType === undefined || !NON_LABELLED_INPUT_TYPES.has(inputType)) && !linked)
      emitWarning(ctx, "rgaa/form-label", element.start, `[rgaa/form-label] <${tag}> in ${ctx.filename} has no associated label: wrap it in <label>, link <label for="id">, or add aria-label="..." / aria-labelledby="...".`);
  }
  if ((tag === "button" || tag === "a") && !spread && !hasLabelAttr(attrs) && !hasAccessibleName(element.children))
    emitWarning(ctx, "rgaa/accessible-name", element.start, `[rgaa/accessible-name] <${tag}> in ${ctx.filename} has no accessible name: add visible text or aria-label="...".`);
  checkRoleAndAria(element, tag, ctx);
  checkFocusAndInteraction(element, tag, spread, ctx);
  checkStructureAndIdentity(element, tag, spread, ctx);
}

// packages/prunelle/src/compiler/compliance.ts
var COMPLIANCE_RULES = new Set([
  ...RGAA_JSX_RULES,
  "rgpd/third-party-url",
  "lcen/legal-notice",
  "rgaa/accessibility-statement"
]);
var THIRD_PARTY_LINK_RELS = new Set(["stylesheet", "preload", "preconnect", "dns-prefetch"]);
var LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
var DEFAULT_LEGAL_PATHS = new Set(["/mentions-legales", "/legal", "/legal-notice", "/imprint", "/impressum", "/cgu", "/cgv"]);
var ACCESSIBILITY_PATHS = new Set(["/accessibilite", "/accessibility", "/declaration-accessibilite", "/accessibility-statement"]);
var LINE_IGNORE_RE = /(?:^|[\s{;(,])\/\/\s*prunelle-ignore(-file)?[ \t]+([^\r\n]+)/g;
var BLOCK_IGNORE_RE = /\/\*\s*prunelle-ignore(-file)?\s+([\s\S]*?)\*\//g;
function buildLineStarts(code) {
  const starts = [0];
  for (let i = 0;i < code.length; i++) {
    if (code.charCodeAt(i) === 10)
      starts.push(i + 1);
  }
  return starts;
}
function offsetToLine(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (lineStarts[mid] <= offset)
      lo = mid;
    else
      hi = mid - 1;
  }
  return lo + 1;
}
function extractRules(text) {
  const out = [];
  for (const token of text.trim().split(/[\s,]+/)) {
    if (COMPLIANCE_RULES.has(token))
      out.push(token);
  }
  return out;
}
function parsePrunelleIgnores(code) {
  const lineStarts = buildLineStarts(code);
  const fileRules = new Set;
  const lineRules = new Map;
  const record = (isFile, start, end, rawRules) => {
    const rules = extractRules(rawRules);
    if (rules.length === 0)
      return;
    if (isFile) {
      for (const r of rules)
        fileRules.add(r);
      return;
    }
    const startLine = offsetToLine(lineStarts, start);
    const endLine = offsetToLine(lineStarts, end);
    for (const line of [startLine, endLine, endLine + 1]) {
      let set = lineRules.get(line);
      if (set === undefined) {
        set = new Set;
        lineRules.set(line, set);
      }
      for (const r of rules)
        set.add(r);
    }
  };
  for (const re of [LINE_IGNORE_RE, BLOCK_IGNORE_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(code);m !== null; m = re.exec(code))
      record(m[1] === "-file", m.index, m.index + m[0].length, m[2]);
  }
  return { lineStarts, fileRules, lineRules };
}
function isIgnoredAt(ignores, rule, offset) {
  if (ignores.fileRules.has(rule))
    return true;
  const line = offsetToLine(ignores.lineStarts, offset);
  return ignores.lineRules.get(line)?.has(rule) === true;
}
function isRuleIgnored(rule, compliance) {
  if (rule === "lcen/legal-notice" && compliance?.legalNotice === false)
    return true;
  return compliance?.ignore?.includes(rule) === true;
}
function parseOrigin(url) {
  if (url === undefined || url.trim() === "")
    return;
  try {
    return new URL(url.trim()).origin;
  } catch {
    return;
  }
}
function thirdPartyOrigin(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!/^(?:https?:)?\/\//i.test(trimmed))
    return;
  try {
    const parsed = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return;
    const host = parsed.hostname.toLowerCase();
    if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost"))
      return;
    return parsed.origin;
  } catch {
    return;
  }
}
function shouldEmitWarning(warning, compliance, site) {
  if (warning.rule !== undefined && isRuleIgnored(warning.rule, compliance))
    return false;
  if (warning.rule === "rgpd/third-party-url" && warning.urlOrigin !== undefined) {
    const siteOrigin = parseOrigin(site);
    if (siteOrigin !== undefined && warning.urlOrigin === siteOrigin)
      return false;
  }
  return true;
}
function walkAst(value, enter) {
  if (value === null || typeof value !== "object")
    return;
  if (Array.isArray(value)) {
    for (let i = 0;i < value.length; i++)
      walkAst(value[i], enter);
    return;
  }
  const node = value;
  if (typeof node.type !== "string")
    return;
  enter(node);
  const keys = import_oxc_parser5.visitorKeys[node.type];
  if (keys !== undefined) {
    for (let i = 0;i < keys.length; i++)
      walkAst(node[keys[i]], enter);
  }
}
function collectLabelTargets(program) {
  const targets = new Set;
  walkAst(program, (node) => {
    if (node.type !== "JSXElement")
      return;
    const tag = jsxTagName(node.openingElement.name);
    if (tag !== "label")
      return;
    const attrs = node.openingElement.attributes;
    const key = attrTargetKey(findAttr(attrs, "for") ?? findAttr(attrs, "htmlFor"));
    if (key !== undefined)
      targets.add(key);
  });
  return targets;
}
function checkThirdPartyElement(element, tag, filename, ignores, warnings) {
  const attrs = element.openingElement.attributes;
  let attr;
  let attrName = "";
  if (tag === "script" || tag === "iframe") {
    attr = findAttr(attrs, "src");
    attrName = "src";
  } else if (tag === "link") {
    const relVal = staticStringValueOf(findAttr(attrs, "rel")?.value ?? null);
    if (relVal === undefined)
      return;
    const rels = relVal.toLowerCase().split(/\s+/);
    if (!rels.some((r) => THIRD_PARTY_LINK_RELS.has(r)))
      return;
    attr = findAttr(attrs, "href");
    attrName = "href";
  }
  if (attr === undefined)
    return;
  const url = staticStringValueOf(attr.value);
  if (url === undefined)
    return;
  const origin = thirdPartyOrigin(url);
  if (origin === undefined || isIgnoredAt(ignores, "rgpd/third-party-url", attr.start))
    return;
  warnings.push({
    rule: "rgpd/third-party-url",
    urlOrigin: origin,
    start: attr.start,
    message: `[rgpd/third-party-url] <${tag} ${attrName}="${url}"> in ${filename} loads a third-party resource without consent: self-host it (e.g. @prunellejs/seo fonts or public/) or wrap it in <ConsentGate category="...">.`
  });
}
function definitelyExits(stmt) {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement")
    return true;
  if (stmt.type === "BlockStatement")
    return stmt.body.length > 0 && definitelyExits(stmt.body[stmt.body.length - 1]);
  if (stmt.type === "IfStatement")
    return stmt.alternate !== null && definitelyExits(stmt.consequent) && definitelyExits(stmt.alternate);
  return false;
}
function checkCompliance(program, filename, code, warnings, resolveTag) {
  const ignores = parsePrunelleIgnores(code);
  const labelTargets = collectLabelTargets(program);
  const isIgnored = (rule, elementStart, attrStart) => isIgnoredAt(ignores, rule, elementStart) || attrStart !== undefined && isIgnoredAt(ignores, rule, attrStart);
  const visitChildren = (node, ancestors, scope) => {
    const keys = import_oxc_parser5.visitorKeys[node.type];
    if (keys === undefined)
      return;
    const rec = node;
    for (let i = 0;i < keys.length; i++)
      visit(rec[keys[i]], ancestors, scope);
  };
  const visit = (value, ancestors, scope) => {
    if (value === null || typeof value !== "object")
      return;
    if (Array.isArray(value)) {
      for (let i = 0;i < value.length; i++)
        visit(value[i], ancestors, scope);
      return;
    }
    const node = value;
    if (typeof node.type !== "string")
      return;
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      visitChildren(node, ancestors, createRgaaScope());
      return;
    }
    if (node.type === "ConditionalExpression") {
      visit(node.test, ancestors, scope);
      const branchA = cloneRgaaScope(scope);
      const branchB = cloneRgaaScope(scope);
      visit(node.consequent, ancestors, branchA);
      visit(node.alternate, ancestors, branchB);
      mergeRgaaScope(scope, branchA);
      mergeRgaaScope(scope, branchB);
      return;
    }
    if (node.type === "IfStatement") {
      visit(node.test, ancestors, scope);
      const branchA = cloneRgaaScope(scope);
      visit(node.consequent, ancestors, branchA);
      const branchB = cloneRgaaScope(scope);
      if (node.alternate !== null)
        visit(node.alternate, ancestors, branchB);
      if (!definitelyExits(node.consequent))
        mergeRgaaScope(scope, branchA);
      if (node.alternate !== null && !definitelyExits(node.alternate))
        mergeRgaaScope(scope, branchB);
      return;
    }
    if (node.type === "JSXElement") {
      const tag = jsxTagName(node.openingElement.name);
      const attrs = node.openingElement.attributes;
      if (tag !== "" && !isComponentTag(tag)) {
        checkRgaaElement(node, tag, {
          filename,
          inLabel: ancestors.labelDepth > 0,
          interactiveAncestor: ancestors.interactiveAncestor,
          labelTargets,
          scope,
          isIgnored,
          warnings
        });
        if (ancestors.consentGateDepth === 0)
          checkThirdPartyElement(node, tag, filename, ignores, warnings);
      }
      visit(attrs, ancestors, scope);
      const opensLabel = tag === "label" || isComponentTag(tag) && hasNonEmptyAttr(attrs, "label");
      const opensConsentGate = resolveTag(tag) === "ConsentGate";
      const nextInteractive = INTERACTIVE_ANCESTORS.has(tag) ? tag : ancestors.interactiveAncestor;
      const childAncestors = opensLabel || opensConsentGate || nextInteractive !== ancestors.interactiveAncestor ? {
        labelDepth: ancestors.labelDepth + (opensLabel ? 1 : 0),
        consentGateDepth: ancestors.consentGateDepth + (opensConsentGate ? 1 : 0),
        interactiveAncestor: nextInteractive
      } : ancestors;
      visit(node.children, childAncestors, scope);
      return;
    }
    visitChildren(node, ancestors, scope);
  };
  visit(program, { labelDepth: 0, consentGateDepth: 0, interactiveAncestor: undefined }, createRgaaScope());
}

// packages/prunelle/src/compiler/interactivity.ts
function resolveInteractivity(bindings, exportLocals, reads = new Map) {
  const named = new Map;
  for (const b of bindings) {
    if (b.name !== "")
      named.set(b.name, b);
  }
  const facts = spreadFacts(bindings, named, reads);
  const exported = new Set(exportLocals.values());
  const serverSide = new Set;
  const stack = bindings.filter((b) => !facts.has(b) && (b.name === "" || exported.has(b.name)));
  for (let b = stack.pop();b !== undefined; b = stack.pop()) {
    if (serverSide.has(b))
      continue;
    serverSide.add(b);
    for (const ref of b.refs.keys()) {
      const dep = named.get(ref);
      if (dep !== undefined && !facts.has(dep))
        stack.push(dep);
    }
  }
  const exports2 = new Map;
  for (const [name, local] of exportLocals) {
    const binding = named.get(local);
    const fact = binding === undefined ? undefined : facts.get(binding);
    exports2.set(name, fact === undefined ? { interactive: false } : { interactive: true, reason: fact.reason, offset: fact.offset });
  }
  const staticJsxTags = new Set([...serverSide].flatMap((b) => [...b.tags]));
  const localIslands = new Map;
  for (const [binding, fact] of facts) {
    if (binding.name !== "" && staticJsxTags.has(binding.name))
      localIslands.set(binding.name, fact);
  }
  const first = bindings.find((b) => facts.has(b));
  const firstFact = first === undefined ? undefined : facts.get(first);
  return {
    isInteractive: facts.size > 0,
    interactiveReason: firstFact?.reason,
    interactiveOffset: firstFact?.offset,
    exports: exports2,
    localIslands,
    staticJsxTags,
    islandSpans: bindings.filter((b) => !serverSide.has(b)).map((b) => [b.start, b.end]),
    browserSpans: [...reachedFrom([...facts.keys()], named)].map((b) => [b.start, b.end]),
    serverOnly: serverOnlyInIsland(bindings, named, facts)
  };
}
function spreadFacts(bindings, named, reads) {
  const facts = new Map;
  let moduleFact;
  for (const b of bindings) {
    let own = b.fact;
    for (const [ref, offset] of b.valueRefs) {
      if (own !== undefined)
        break;
      const reason = reads.get(ref);
      if (reason !== undefined) {
        own = { reason, offset };
        continue;
      }
      const members = b.memberRefs.get(ref);
      if (members !== undefined) {
        for (const m of members) {
          const mReason = reads.get(`${ref}.${m}`);
          if (mReason !== undefined) {
            own = { reason: mReason, offset };
            break;
          }
        }
      }
    }
    if (own !== undefined)
      facts.set(b, own);
    if (b.name === "")
      moduleFact ??= own;
  }
  if (moduleFact !== undefined) {
    for (const b of named.values()) {
      if (!facts.has(b))
        facts.set(b, moduleFact);
    }
  }
  for (let changed = true;changed; ) {
    changed = false;
    for (const b of named.values()) {
      if (facts.has(b))
        continue;
      for (const [ref, offset] of b.refs) {
        if (b.tags.has(ref) && !b.valueRefs.has(ref))
          continue;
        const dep = named.get(ref);
        const depFact = dep === undefined ? undefined : facts.get(dep);
        if (depFact !== undefined) {
          facts.set(b, { reason: `uses ${ref}, which ${depFact.reason}`, offset });
          changed = true;
          break;
        }
      }
    }
  }
  return facts;
}
function serverOnlyInIsland(bindings, named, facts) {
  for (const island of bindings) {
    const fact = facts.get(island);
    if (fact === undefined)
      continue;
    const seen = new Set;
    const stack = [island];
    for (let b = stack.pop();b !== undefined; b = stack.pop()) {
      if (seen.has(b))
        continue;
      seen.add(b);
      if (b.serverOnlyTag !== undefined) {
        const name = island.name === "" ? "the module" : island.name === "default" ? "the default export" : island.name;
        return { tag: b.serverOnlyTag, island: name, reason: fact.reason, offset: fact.offset };
      }
      for (const ref of b.refs.keys()) {
        const dep = named.get(ref);
        if (dep !== undefined)
          stack.push(dep);
      }
    }
  }
  return;
}
function reachedFrom(roots, named) {
  const seen = new Set;
  const stack = [...roots];
  for (let b = stack.pop();b !== undefined; b = stack.pop()) {
    if (seen.has(b))
      continue;
    seen.add(b);
    for (const ref of b.refs.keys()) {
      const dep = named.get(ref);
      if (dep !== undefined)
        stack.push(dep);
    }
  }
  return seen;
}

// packages/prunelle/src/compiler/node-env.ts
var MENTIONS_RE2 = /\bNODE_ENV\b/;
function keyOf(member) {
  if (!member.computed && member.property.type === "Identifier")
    return member.property.name;
  if (member.computed && member.property.type === "Literal" && typeof member.property.value === "string")
    return member.property.value;
  return;
}
function isProcessEnv(node, shadowing) {
  const env = unwrapTsExpr(node);
  if (env.type !== "MemberExpression" || keyOf(env) !== "env")
    return false;
  const proc = unwrapTsExpr(env.object);
  if (proc.type === "Identifier")
    return proc.name === "process" && !shadowing.has("process");
  if (proc.type !== "MemberExpression" || keyOf(proc) !== "process")
    return false;
  const base = unwrapTsExpr(proc.object);
  return base.type === "Identifier" && base.name === "globalThis" && !shadowing.has("globalThis");
}
function findNodeEnvReads(program, code) {
  if (!MENTIONS_RE2.test(code))
    return [];
  const shadowing = topLevelNames(program);
  const reads = [];
  walk(program, (node) => {
    if (node.type === "MemberExpression" && keyOf(node) === "NODE_ENV" && isProcessEnv(node.object, shadowing)) {
      reads.push(node.start);
    } else if (node.type === "VariableDeclarator" && node.id.type === "ObjectPattern" && node.init !== null && isProcessEnv(node.init, shadowing)) {
      for (const prop of node.id.properties) {
        if (prop.type === "Property" && !prop.computed && prop.key.type === "Identifier" && prop.key.name === "NODE_ENV")
          reads.push(prop.start);
      }
    }
  });
  return reads;
}

// packages/prunelle/src/compiler/mistakes.ts
var EVENT_PROPS = new Map(Object.entries({
  abort: "onAbort",
  animationcancel: "onAnimationCancel",
  animationend: "onAnimationEnd",
  animationiteration: "onAnimationIteration",
  animationstart: "onAnimationStart",
  auxclick: "onAuxClick",
  beforeinput: "onBeforeInput",
  beforetoggle: "onBeforeToggle",
  blur: "onBlur",
  cancel: "onCancel",
  canplay: "onCanPlay",
  canplaythrough: "onCanPlayThrough",
  change: "onChange",
  click: "onClick",
  close: "onClose",
  compositionend: "onCompositionEnd",
  compositionstart: "onCompositionStart",
  compositionupdate: "onCompositionUpdate",
  contextmenu: "onContextMenu",
  copy: "onCopy",
  cut: "onCut",
  dblclick: "onDblClick",
  drag: "onDrag",
  dragend: "onDragEnd",
  dragenter: "onDragEnter",
  dragleave: "onDragLeave",
  dragover: "onDragOver",
  dragstart: "onDragStart",
  drop: "onDrop",
  durationchange: "onDurationChange",
  emptied: "onEmptied",
  ended: "onEnded",
  error: "onError",
  focus: "onFocus",
  focusin: "onFocusIn",
  focusout: "onFocusOut",
  formdata: "onFormData",
  gotpointercapture: "onGotPointerCapture",
  input: "onInput",
  invalid: "onInvalid",
  keydown: "onKeyDown",
  keypress: "onKeyPress",
  keyup: "onKeyUp",
  load: "onLoad",
  loadeddata: "onLoadedData",
  loadedmetadata: "onLoadedMetadata",
  loadstart: "onLoadStart",
  lostpointercapture: "onLostPointerCapture",
  mousedown: "onMouseDown",
  mouseenter: "onMouseEnter",
  mouseleave: "onMouseLeave",
  mousemove: "onMouseMove",
  mouseout: "onMouseOut",
  mouseover: "onMouseOver",
  mouseup: "onMouseUp",
  paste: "onPaste",
  pause: "onPause",
  play: "onPlay",
  playing: "onPlaying",
  pointercancel: "onPointerCancel",
  pointerdown: "onPointerDown",
  pointerenter: "onPointerEnter",
  pointerleave: "onPointerLeave",
  pointermove: "onPointerMove",
  pointerout: "onPointerOut",
  pointerover: "onPointerOver",
  pointerup: "onPointerUp",
  progress: "onProgress",
  ratechange: "onRateChange",
  reset: "onReset",
  resize: "onResize",
  scroll: "onScroll",
  scrollend: "onScrollEnd",
  securitypolicyviolation: "onSecurityPolicyViolation",
  seeked: "onSeeked",
  seeking: "onSeeking",
  select: "onSelect",
  selectionchange: "onSelectionChange",
  selectstart: "onSelectStart",
  slotchange: "onSlotChange",
  stalled: "onStalled",
  submit: "onSubmit",
  suspend: "onSuspend",
  timeupdate: "onTimeUpdate",
  toggle: "onToggle",
  touchcancel: "onTouchCancel",
  touchend: "onTouchEnd",
  touchmove: "onTouchMove",
  touchstart: "onTouchStart",
  transitioncancel: "onTransitionCancel",
  transitionend: "onTransitionEnd",
  transitionrun: "onTransitionRun",
  transitionstart: "onTransitionStart",
  volumechange: "onVolumeChange",
  waiting: "onWaiting",
  wheel: "onWheel",
  afterprint: "onAfterPrint",
  beforeprint: "onBeforePrint",
  beforeunload: "onBeforeUnload",
  hashchange: "onHashChange",
  message: "onMessage",
  offline: "onOffline",
  online: "onOnline",
  pagehide: "onPageHide",
  pageshow: "onPageShow",
  popstate: "onPopState",
  storage: "onStorage",
  unload: "onUnload",
  fullscreenchange: "onFullscreenChange",
  fullscreenerror: "onFullscreenError",
  loadend: "onLoadEnd",
  search: "onSearch",
  beforematch: "onBeforeMatch",
  command: "onCommand",
  cuechange: "onCueChange",
  encrypted: "onEncrypted",
  waitingforkey: "onWaitingForKey",
  pointerrawupdate: "onPointerRawUpdate",
  contextlost: "onContextLost",
  contextrestored: "onContextRestored",
  contentvisibilityautostatechange: "onContentVisibilityAutoStateChange"
}));
var RENAMED_EVENTS = new Map([["doubleclick", "dblclick"]]);
var CAPTURE_SUFFIX = "capture";
var LOWERCASE_EVENT = /^on[a-z]/;
function eventProp(event) {
  return EVENT_PROPS.get(event) ?? `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
}

class PrunelleMistake extends Error {
  start = undefined;
}
function mistake(what, filename, fix) {
  return new PrunelleMistake(`prunelle compiler: ${what} in ${filename}: ${fix}.`);
}
var collected;
function guarded(start, check) {
  try {
    check();
  } catch (err) {
    if (!(err instanceof PrunelleMistake))
      throw err;
    err.start ??= start;
    if (collected === undefined)
      throw err;
    collected.push(err);
  }
}
function collectMistakes(fn) {
  const prev = collected;
  const mistakes = [];
  collected = mistakes;
  try {
    return { value: fn(), mistakes, error: undefined };
  } catch (error) {
    return { value: undefined, mistakes, error };
  } finally {
    collected = prev;
  }
}
function islandRemoved(filename, start) {
  const err = mistake("island()", filename, "it is gone; write export const hydrate = 'visible' in the component's file, or set $hydrate where it renders");
  err.start = start;
  return err;
}
function serverOnlyTagError(filename, { tag, island, reason, offset }) {
  const err = mistake(`<${tag}> in an island`, filename, `${island} is an island because it ${reason}; move <${tag}> to the page or a layout, outside any component with state or handlers`);
  err.start = offset;
  return err;
}
var KAY_SOURCE_RE = /^@kayjs\/(kay(?=\/|$))?/;
function assertNoKayImport(source, filename) {
  const match = KAY_SOURCE_RE.exec(source);
  if (match !== null)
    throw mistake(`import from '${source}'`, filename, `write '${source.replace(KAY_SOURCE_RE, match[1] === undefined ? "@prunellejs/" : "prunelle")}' (prunelle upgrade rewrites every import)`);
}
var HYDRATE_MODES = new Set(["load", "visible", "idle", "interaction", "client"]);
var MEDIA_MODE = /^media\(.+\)$/;
function checkHydrateMode(mode, what, filename) {
  if (mode !== "*" && !HYDRATE_MODES.has(mode) && !MEDIA_MODE.test(mode))
    throw mistake(what, filename, "use load, visible, idle, interaction, client or media(<query>)");
}
function staticStringValue(node) {
  if (node === null || node === undefined)
    return;
  const val = unwrapTsExpr(node);
  if (val.type === "Literal" && typeof val.value === "string")
    return val.value;
  return val.type === "TemplateLiteral" && val.expressions.length === 0 ? val.quasis[0]?.value.cooked ?? undefined : undefined;
}
function checkExportHydrate(init, filename) {
  if (init === null || init === undefined)
    return;
  const mode = staticStringValue(init);
  if (mode !== undefined) {
    guarded(init.start, () => checkHydrateMode(mode, `hydrate = "${mode}"`, filename));
    return mode;
  }
  const val = unwrapTsExpr(init);
  if (val.type === "Literal" || val.type === "ArrayExpression" || val.type === "ObjectExpression" || val.type === "Identifier" && val.name === "undefined")
    guarded(init.start, () => {
      throw mistake("hydrate", filename, "use load, visible, idle, interaction, client or media(<query>)");
    });
  return;
}
function checkHandler(name, value, filename, code) {
  if (value === null)
    throw mistake(name, filename, `pass a function, ${name}={() => ...}`);
  if (value.type === "Literal")
    throw mistake(`${name}="..."`, filename, `pass a function, ${name}={() => ...}`);
  if (value.type !== "JSXExpressionContainer")
    return;
  const expr = unwrapParens(value.expression);
  if (expr.type === "Literal" && typeof expr.value === "string" || expr.type === "TemplateLiteral")
    throw mistake(`${name}="..."`, filename, `pass a function, ${name}={() => ...}`);
  if (expr.type === "UpdateExpression" || expr.type === "AssignmentExpression") {
    const source = code.slice(expr.start, expr.end);
    throw mistake(`${name} runs ${source} at render`, filename, `write ${name}={() => ${source}}`);
  }
}
var KEBAB_SVG_ATTRS = new Set([
  "alignment-baseline",
  "baseline-shift",
  "clip-path",
  "clip-rule",
  "color-interpolation",
  "color-interpolation-filters",
  "dominant-baseline",
  "enable-background",
  "fill-opacity",
  "fill-rule",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "image-rendering",
  "letter-spacing",
  "lighting-color",
  "marker-end",
  "marker-mid",
  "marker-start",
  "paint-order",
  "pointer-events",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "text-decoration",
  "text-rendering",
  "transform-origin",
  "unicode-bidi",
  "vector-effect",
  "word-spacing",
  "writing-mode"
]);
var CAMEL_HUMP = /[A-Z]/g;
var REACT_DEFAULTS = new Map([["defaultValue", "value"], ["defaultChecked", "checked"]]);
var BOOLEAN_ATTRS = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected"
]);
function checkRef(value, filename) {
  if (value === null)
    throw mistake("ref", filename, "pass a function, ref={el => ...}");
  if (value.type === "Literal")
    throw mistake('ref="..."', filename, "pass a function, ref={el => ...}");
  if (value.type === "JSXExpressionContainer" && unwrapParens(value.expression).type === "ObjectExpression")
    throw mistake("ref={{ ... }}", filename, "pass a function, ref={el => ...}, prunelle has no ref objects");
}
var CAMEL_ARIA = /^aria[A-Z]/;
function checkSpelling(name, value, filename) {
  if (CAMEL_ARIA.test(name))
    throw mistake(name, filename, `write aria-${name.slice(4).toLowerCase()}={...}, ARIA attributes use kebab-case`);
  const kebab = name.replace(CAMEL_HUMP, (hump) => `-${hump.toLowerCase()}`);
  if (kebab !== name && KEBAB_SVG_ATTRS.has(kebab))
    throw mistake(name, filename, `write ${kebab}={...}, SVG attributes are case-sensitive`);
  if (name === "xlinkHref")
    throw mistake(name, filename, "write xlink:href={...}, or href={...}");
  const attribute = REACT_DEFAULTS.get(name);
  if (attribute !== undefined)
    throw mistake(name, filename, `write ${attribute}={...}`);
  if (value?.type === "Literal" && value.value === "false" && BOOLEAN_ATTRS.has(name.toLowerCase()))
    throw mistake(`${name}="false"`, filename, `write ${name}={false}, any string turns it on`);
}
var CLIENT_DIRECTIVES = new Map([["load", "load"], ["visible", "visible"], ["idle", "idle"], ["only", "client"], ["media", "media(<query>)"]]);
var XML_NAMESPACES = new Set(["xlink", "xml", "xmlns"]);
function checkNamespacedAttribute(namespace, name, filename) {
  if (XML_NAMESPACES.has(namespace))
    return;
  const what = `${namespace}:${name}`;
  if (namespace === "on")
    throw mistake(what, filename, `write ${eventProp(name.toLowerCase())}={...}`);
  if (namespace === "client")
    throw mistake(what, filename, `write $hydrate="${CLIENT_DIRECTIVES.get(name) ?? "load"}"`);
  if (what === "class:list")
    throw mistake(what, filename, "pass one string to class, joining the names yourself");
  if (what === "set:html")
    throw mistake(what, filename, "write innerHTML={...}");
  if (what === "set:text")
    throw mistake(what, filename, "write the text as children");
  if (namespace === "use")
    throw mistake(what, filename, `call ${name} in a ref`);
  if (namespace === "prop" || namespace === "attr" || namespace === "bool")
    throw mistake(what, filename, `write ${name}={...}`);
  throw mistake(what, filename, `prunelle has no ${namespace}: directives`);
}
function reactHtmlSource(value, code) {
  if (value?.type !== "JSXExpressionContainer")
    return;
  const expr = unwrapParens(value.expression);
  if (expr.type !== "ObjectExpression")
    return;
  for (const p of expr.properties) {
    if (p.type !== "Property")
      continue;
    const keyName = p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : undefined;
    if (keyName === "__html")
      return code.slice(p.value.start, p.value.end);
  }
  return;
}
function checkInnerHtml(element, tag, attr, filename, code) {
  const html = reactHtmlSource(attr.value, code);
  if (html !== undefined)
    throw mistake("innerHTML={{ __html }}", filename, `write innerHTML={${html}}, prunelle takes the HTML string itself`);
  if (VOID_ELEMENTS.has(tag))
    throw mistake(`innerHTML on <${tag}>`, filename, "a void element has no content, drop innerHTML");
  if (filterMeaningfulChildren(element.children).length > 0)
    throw mistake("innerHTML with children", filename, "keep one, the children or innerHTML");
}
function staticStringAttr(value) {
  if (value === null)
    return;
  if (value.type === "Literal" && typeof value.value === "string")
    return value.value;
  if (value.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression") {
    const expr = unwrapParens(value.expression);
    if (expr.type === "Literal" && typeof expr.value === "string")
      return expr.value;
    if (expr.type === "TemplateLiteral" && expr.expressions.length === 0)
      return expr.quasis[0]?.value.cooked ?? undefined;
  }
  return;
}
function checkElementAttribute(attr, tag, isCustomElement, filename, code, warnings) {
  if (attr.name.type !== "JSXIdentifier")
    return;
  const name = attr.name.name;
  if (name === "$hydrate")
    throw mistake(`$hydrate on <${tag}>`, filename, "only components can be islands; drop $hydrate, or move it onto a component tag");
  if (name.toLowerCase() === "srcdoc")
    throw mistake(`${name} on <${tag}>`, filename, "prunelle blocks srcdoc for XSS safety; serve the document from a route and load it with src");
  if (name === "dangerouslySetInnerHTML")
    throw mistake(name, filename, `write innerHTML={${reactHtmlSource(attr.value, code) ?? "..."}}`);
  if (name === "classList")
    throw mistake(name, filename, "pass one string to class, joining the names yourself");
  if (name === "ref")
    return checkRef(attr.value, filename);
  checkSpelling(name, attr.value, filename);
  if (URL_ATTRS.has(name.toLowerCase())) {
    const urlText = staticStringAttr(attr.value);
    if (urlText !== undefined && isUnsafeUrlAttr(name, urlText, tag))
      warnings.push({ message: `prunelle compiler: unsafe URL in ${name} on <${tag}> in ${filename}; prunelle strips javascript:, vbscript:, and non-image data: URLs.`, start: attr.start });
  }
  if (LOWERCASE_EVENT.test(name) && EVENT_PROPS.has(name.slice(2)))
    throw mistake(name, filename, `write ${eventProp(name.slice(2))}={...}, prunelle binds camelCase event props only`);
  if (!EVENT_ATTR.test(name))
    return;
  checkHandler(name, attr.value, filename, code);
  if (!isCustomElement)
    checkEventName(name, filename);
}
function checkEventName(name, filename) {
  const event = name.slice(2).toLowerCase();
  if (EVENT_PROPS.has(event))
    return;
  const renamed = RENAMED_EVENTS.get(event);
  if (renamed !== undefined)
    throw mistake(name, filename, `write ${eventProp(renamed)}={...}`);
  if (event.endsWith(CAPTURE_SUFFIX) && EVENT_PROPS.has(event.slice(0, -CAPTURE_SUFFIX.length)))
    throw mistake(name, filename, `prunelle has no capture props, call addEventListener('${event.slice(0, -CAPTURE_SUFFIX.length)}', fn, { capture: true }) in a ref`);
  throw mistake(name, filename, `no DOM event is named "${event}"; for a custom event, call addEventListener in a ref`);
}
var UNFOCUSABLE_TAGS = new Set([
  "article",
  "aside",
  "div",
  "fieldset",
  "footer",
  "form",
  "header",
  "label",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "section",
  "span",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul"
]);
var FOCUS_EVENTS = new Map([["onFocus", "onFocusIn"], ["onBlur", "onFocusOut"]]);
var TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
function staticAttr(attributes, name) {
  for (const a of attributes) {
    if (a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === name)
      return a;
  }
  return;
}
function checkFocusAndChange(tag, attributes, filename, warnings) {
  const canFocus = !UNFOCUSABLE_TAGS.has(tag) || attributes.some((a) => a.type === "JSXSpreadAttribute" || a.name.type === "JSXIdentifier" && ["tabIndex", "tabindex", "contentEditable", "contenteditable"].includes(a.name.name));
  for (const [prop, bubbling] of FOCUS_EVENTS) {
    const attr = canFocus ? undefined : staticAttr(attributes, prop);
    if (attr !== undefined)
      guarded(attr.start, () => {
        throw mistake(`${prop} on <${tag}>`, filename, `focus does not bubble, write ${bubbling}={...}, or give the <${tag}> a tabIndex`);
      });
  }
  const onChange = staticAttr(attributes, "onChange");
  if (onChange === undefined)
    return;
  const type = staticAttr(attributes, "type")?.value;
  const isTextField = tag === "textarea" || tag === "input" && (type === undefined || type?.type === "Literal" && typeof type.value === "string" && TEXT_INPUT_TYPES.has(type.value));
  if (isTextField)
    warnings.push({ message: `prunelle compiler: onChange on <${tag}> in ${filename} fires when the field loses focus, not per keystroke; write onInput={...} for every keystroke.`, start: onChange.start });
}
function checkMistakes(element, filename, code, warnings, resolveTag = (t) => t === "Suspense" || t === "Region" ? t : undefined) {
  const tag = jsxTagName(element.openingElement.name);
  const canonical = resolveTag(tag);
  const isElement = tag !== "" && !isComponentTag(tag);
  const isCustomElement = tag.includes("-");
  if (canonical === "Suspense") {
    const children = filterMeaningfulChildren(element.children).length;
    if (children > 1)
      guarded(element.start, () => {
        throw mistake(`<Suspense> with ${children} children`, filename, "give it one child, and one <Suspense> per async component");
      });
  }
  const attributes = element.openingElement.attributes;
  guarded(element.start, () => checkRegionMarkup(tag, canonical, isElement, attributes, filename, element, resolveTag));
  if (isElement)
    guarded(element.start, () => checkKeepScroll(element, attributes, filename));
  if (isElement && VOID_ELEMENTS.has(tag) && (filterMeaningfulChildren(element.children).length > 0 || staticAttr(attributes, "children") !== undefined))
    guarded(element.start, () => {
      throw mistake(`<${tag}> with children`, filename, `a void element has no content; write <${tag} />`);
    });
  const className = isElement && staticAttr(attributes, "class") !== undefined ? staticAttr(attributes, "className") : undefined;
  if (className !== undefined)
    guarded(className.start, () => {
      throw mistake("class and className", filename, "keep one, they set the same attribute");
    });
  const htmlFor = isElement && staticAttr(attributes, "for") !== undefined ? staticAttr(attributes, "htmlFor") : undefined;
  if (htmlFor !== undefined)
    guarded(htmlFor.start, () => {
      throw mistake("for and htmlFor", filename, "keep one, they set the same attribute");
    });
  if (isElement)
    checkFocusAndChange(tag, attributes, filename, warnings);
  for (const attr of attributes) {
    if (attr.type !== "JSXAttribute")
      continue;
    guarded(attr.start, () => {
      if (attr.name.type === "JSXNamespacedName")
        checkNamespacedAttribute(attr.name.namespace.name, attr.name.name.name, filename);
      else if (isElement && attr.name.name === "innerHTML")
        checkInnerHtml(element, tag, attr, filename, code);
      else if (isElement)
        checkElementAttribute(attr, tag, isCustomElement, filename, code, warnings);
    });
  }
}
function literalText(attr) {
  return attr.value?.type === "Literal" && typeof attr.value.value === "string" ? attr.value.value : undefined;
}
function checkRegionNesting(element, attributes, filename, resolveTag) {
  const outer = staticAttr(attributes, "name");
  const name = outer === undefined ? undefined : literalText(outer);
  if (name === undefined)
    return;
  walk(element.children, (node) => {
    if (node.type !== "JSXElement" || resolveTag(jsxTagName(node.openingElement.name)) !== "Region")
      return;
    const inner = staticAttr(node.openingElement.attributes, "name");
    if (inner !== undefined && literalText(inner) === name)
      throw mistake(`<Region name="${name}"> inside <Region name="${name}">`, filename, "give the inner one its own name");
  });
}
function checkRegionMarkup(tag, canonical, isElement, attributes, filename, element, resolveTag) {
  if (canonical === "Region")
    checkRegionNesting(element, attributes, filename, resolveTag);
  if (canonical === "Region" && staticAttr(attributes, "name") === undefined && !attributes.some((a) => a.type === "JSXSpreadAttribute"))
    throw mistake("<Region> without a name", filename, 'write <Region name="pane">, the name a link names in data-pru-target');
  if (!isElement)
    return;
  const target = staticAttr(attributes, "data-pru-target");
  if (target !== undefined && tag !== "a" && tag !== "form")
    throw mistake(`data-pru-target on <${tag}>`, filename, "put it on the <a href> or the <form> that should swap the region");
  const method = tag === "form" && target !== undefined ? staticAttr(attributes, "method") : undefined;
  const methodText = method === undefined ? undefined : literalText(method);
  if (methodText !== undefined && methodText.toLowerCase() !== "get" && staticAttr(attributes, "data-pru-live") !== undefined)
    throw mistake(`data-pru-live on a <form method="${methodText}">`, filename, 'a form that swaps while typing is a GET: use method="get", or drop data-pru-live');
  if (target === undefined && staticAttr(attributes, "data-pru-append") !== undefined)
    throw mistake("data-pru-append without data-pru-target", filename, 'name the region the next page is appended to: data-pru-target="results"');
  if (staticAttr(attributes, "data-pru-live") !== undefined && (tag !== "form" || target === undefined))
    throw mistake("data-pru-live", filename, 'it belongs on a <form method="get" data-pru-target="..."> that swaps while typing');
}
function checkKeepScroll(element, attributes, filename) {
  const attr = staticAttr(attributes, "data-pru-keep-scroll");
  if (attr === undefined)
    return;
  const keyOf = (a) => a.value?.type === "JSXExpressionContainer" ? staticStringValue(a.value.expression) : literalText(a);
  const key = keyOf(attr);
  if (key === undefined || key.trim() === "" || /["<>&]/.test(key))
    throw mistake("data-pru-keep-scroll without a literal key", filename, 'write data-pru-keep-scroll="side": a plain string naming the panel, with no quote, < > or &');
  walk(element.children, (node) => {
    if (node.type !== "JSXElement")
      return;
    const inner = staticAttr(node.openingElement.attributes, "data-pru-keep-scroll");
    if (inner !== undefined && keyOf(inner) === key)
      throw mistake(`data-pru-keep-scroll="${key}" inside data-pru-keep-scroll="${key}"`, filename, "give each panel its own key");
  });
}
var DIRECTIVE_FIXES = {
  "use client": "delete it, prunelle makes a component an island by itself when it uses state or handlers",
  "use server": "delete it, a server function is an action() exported from its own file"
};
function checkHabits(node, isEffect, filename) {
  if (node.type === "ExpressionStatement" && "directive" in node && typeof node.directive === "string") {
    const fix = DIRECTIVE_FIXES[node.directive];
    if (fix !== undefined)
      guarded(node.start, () => {
        throw mistake(`'${node.directive}'`, filename, fix);
      });
    return;
  }
  if (node.type !== "CallExpression" || !isEffect(calleeName(node.callee)))
    return;
  const fn = node.arguments[0];
  if ((fn?.type === "ArrowFunctionExpression" || fn?.type === "FunctionExpression") && fn.async)
    guarded(fn.start, () => {
      throw mistake("effect(async ...)", filename, "effect tracks only what it reads before the first await and takes a cleanup function, not a Promise; start the async work inside a plain effect");
    });
}

// packages/prunelle/src/compiler/signal-reads.ts
var import_oxc_parser6 = require("oxc-parser");
function bindPattern(scope, pattern, isSignal = false) {
  if (pattern === null || pattern === undefined)
    return;
  if (pattern.type === "Identifier") {
    scope.set(pattern.name, isSignal);
    return;
  }
  walk(pattern, (node) => {
    if (node.type === "Identifier")
      scope.set(node.name, false);
    if (node.type === "AssignmentPattern")
      bindPattern(scope, node.left);
    else if (node.type === "Property")
      bindPattern(scope, node.value);
    return node.type !== "AssignmentPattern" && node.type !== "Property";
  });
}
function bindStatements(scope, statements, signalCallees, importedSignals) {
  for (const stmt of statements) {
    const decl = stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        const init = d.init === null ? undefined : unwrapTsExpr(d.init);
        bindPattern(scope, d.id, init?.type === "CallExpression" && signalCallees.has(calleeName(init.callee)));
      }
    } else if ((decl?.type === "FunctionDeclaration" || decl?.type === "ClassDeclaration") && decl.id !== null) {
      scope.set(decl.id.name, false);
    } else if (decl?.type === "ImportDeclaration") {
      for (const spec of decl.specifiers)
        scope.set(spec.local.name, importedSignals?.has(spec.local.name) === true);
    }
  }
}
function scopeOf(node, signalCallees, importedSignals) {
  const scope = new Map;
  switch (node.type) {
    case "Program":
      bindStatements(scope, node.body, signalCallees, importedSignals);
      return scope;
    case "BlockStatement":
    case "StaticBlock":
      bindStatements(scope, node.body, signalCallees);
      return scope;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      if (node.type === "FunctionExpression" && node.id !== null)
        scope.set(node.id.name, false);
      for (const param of node.params)
        bindPattern(scope, param);
      return scope;
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement": {
      const head = node.type === "ForStatement" ? node.init : node.left;
      if (head?.type === "VariableDeclaration")
        bindStatements(scope, [head], signalCallees);
      return scope;
    }
    case "CatchClause":
      bindPattern(scope, node.param);
      return scope;
    case "SwitchStatement":
      for (const c of node.cases)
        bindStatements(scope, c.consequent, signalCallees);
      return scope;
    default:
      return;
  }
}
function walkWithSignals(program, signalCallees, importedSignals, importedSignalMembers, visit) {
  const scopes = [];
  const lookup = {
    isSignal(name) {
      for (let i = scopes.length - 1;i >= 0; i--) {
        const found = scopes[i].get(name);
        if (found !== undefined)
          return found;
      }
      return false;
    },
    isSignalMember(obj, prop) {
      const members = importedSignalMembers.get(obj);
      if (members === undefined || !members.has(prop))
        return false;
      for (let i = scopes.length - 1;i >= 1; i--) {
        if (scopes[i].has(obj))
          return false;
      }
      return true;
    }
  };
  const visitor = (node) => {
    visit(node, lookup);
    const scope = scopeOf(node, signalCallees, importedSignals);
    if (scope === undefined)
      return;
    scopes.push(scope);
    for (const key of import_oxc_parser6.visitorKeys[node.type] ?? [])
      walk(node[key], visitor);
    scopes.pop();
    return false;
  };
  walk(program, visitor);
}
function bareSignal(expr, lookup) {
  const node = unwrapTsExpr(expr);
  if (node.type === "Identifier")
    return lookup.isSignal(node.name) ? { name: node.name, start: node.start } : undefined;
  if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier") {
    if (lookup.isSignalMember(node.object.name, node.property.name))
      return { name: `${node.object.name}.${node.property.name}`, start: node.start };
    return;
  }
  if (node.type === "LogicalExpression" || node.type === "BinaryExpression")
    return bareSignal(node.left, lookup) ?? bareSignal(node.right, lookup);
  if (node.type === "ConditionalExpression")
    return bareSignal(node.test, lookup) ?? bareSignal(node.consequent, lookup) ?? bareSignal(node.alternate, lookup);
  if (node.type === "UnaryExpression")
    return bareSignal(node.argument, lookup);
  if (node.type === "TemplateLiteral") {
    for (const part of node.expressions) {
      const found = bareSignal(part, lookup);
      if (found !== undefined)
        return found;
    }
  }
  return;
}
function jsxReads(node) {
  if (node.type !== "JSXElement" && node.type !== "JSXFragment")
    return [];
  const reads = [];
  for (const child of node.children) {
    if (child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression")
      reads.push(child.expression);
  }
  if (node.type !== "JSXElement" || isComponentTag(jsxTagName(node.openingElement.name)))
    return reads;
  for (const attr of node.openingElement.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier")
      continue;
    const name = attr.name.name;
    if (name !== "" && name !== "ref" && name !== "key" && !EVENT_ATTR.test(name) && attr.value?.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression")
      reads.push(attr.value.expression);
  }
  return reads;
}
function codeTests(node) {
  switch (node.type) {
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ConditionalExpression":
      return [node.test];
    case "ForStatement":
      return node.test === null ? [] : [node.test];
    case "UnaryExpression":
      return node.operator === "!" ? [node.argument] : [];
    default:
      return [];
  }
}
function destructuredSignal(node, lookup) {
  if (node.type !== "VariableDeclarator" || node.id.type !== "ObjectPattern" || node.init === null)
    return;
  const init = unwrapTsExpr(node.init);
  const name = init.type === "Identifier" && lookup.isSignal(init.name) ? init.name : init.type === "MemberExpression" && !init.computed && init.object.type === "Identifier" && init.property.type === "Identifier" && lookup.isSignalMember(init.object.name, init.property.name) ? `${init.object.name}.${init.property.name}` : undefined;
  if (name === undefined)
    return;
  const takesValue = node.id.properties.some((p) => p.type === "Property" && !p.computed && p.key.type === "Identifier" && p.key.name === "value");
  return takesValue ? name : undefined;
}
function checkBareSignals(program, signalCallees, filename, importedSignals = new Set, importedSignalMembers = new Map) {
  if (signalCallees.size === 0 && importedSignals.size === 0 && importedSignalMembers.size === 0)
    return;
  const reported = new Set;
  walkWithSignals(program, signalCallees, importedSignals, importedSignalMembers, (node, lookup) => {
    for (const expr of [...jsxReads(node), ...codeTests(node)]) {
      const found = bareSignal(expr, lookup);
      if (found === undefined || reported.has(found.start))
        continue;
      reported.add(found.start);
      guarded(found.start, () => {
        throw mistake(`${found.name} without .value`, filename, `write ${found.name}.value`);
      });
    }
    const copied = destructuredSignal(node, lookup);
    if (copied !== undefined)
      guarded(node.start, () => {
        throw mistake(`{ value } = ${copied}`, filename, `read ${copied}.value where it is used, a copied value never updates`);
      });
  });
}

// packages/prunelle/src/compiler/analyze.ts
var REACTIVE_IMPORTS = new Set(["signal", "computed", "effect", "onMount", "onCleanup", "selector", "store", "useAction"]);
var STATE_PRIMITIVES = new Set(["signal", "computed", "selector", "store"]);
var PRUNELLE_SOURCES = new Set(["prunelle"]);
var PRUNELLE_SSR_SOURCES = new Set(["prunelle", "prunelle/internal/ssr"]);
var PRUNELLE_SERVER_SOURCES = new Set(["prunelle/server"]);
var RENDER_CONTEXT_IMPORTS = new Set(["Head", "Region", "Suspense", "ConsentGate", "createContext", "provideContext", "useContext", "useId"]);
var SERVER_ONLY_TAGS = new Set(["Head", "Region", "Suspense", "ConsentGate"]);
function exportedName(node) {
  return node.type === "Identifier" ? node.name : node.value;
}
function loadDeclarations(program) {
  const SERVER_ROUTE_EXPORTS = new Set(["load", "clientData"]);
  const localNames = new Set;
  const found = [];
  const collect = (stmt, names) => {
    if (stmt === null)
      return;
    if (stmt.type === "FunctionDeclaration" && stmt.id !== null && names.has(stmt.id.name)) {
      found.push(stmt);
    } else if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier" && names.has(d.id.name) && d.init !== null)
          found.push(d.init);
      }
    }
  };
  for (const stmt of program.body) {
    if (stmt.type !== "ExportNamedDeclaration" || stmt.source !== null)
      continue;
    if (stmt.declaration !== null)
      collect(stmt.declaration, SERVER_ROUTE_EXPORTS);
    for (const spec of stmt.specifiers) {
      const exp = exportedName(spec.exported);
      if (exp !== undefined && SERVER_ROUTE_EXPORTS.has(exp) && spec.local.type === "Identifier")
        localNames.add(spec.local.name);
    }
  }
  if (localNames.size > 0) {
    for (const stmt of program.body)
      collect(stmt, localNames);
  }
  return found;
}
var ENTITY_HINT_RE = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
function decodeAttributeEntities(program) {
  walk(program, (node) => {
    if (node.type !== "JSXAttribute" || node.value?.type !== "Literal" || typeof node.value.value !== "string")
      return;
    if (node.name.type === "JSXIdentifier" && node.name.name === "innerHTML")
      return;
    node.value.value = decodeHtmlEntities(node.value.value);
  });
}
function parseTsx(filename, code) {
  const lang = /\.[cm]?ts$/i.test(filename) ? "ts" : "tsx";
  const result = import_oxc_parser7.parseSync(filename, code, { lang, sourceType: "module" });
  if (result.errors.length > 0) {
    const first = result.errors[0];
    const label = first.labels?.[0];
    const offset = label?.start ?? 0;
    const loc = formatLoc(filename, code, offset);
    const frame = formatCodeFrame(code, offset, label?.end);
    const header = formatDiagnostic(loc, `prunelle compiler: syntax error: ${first.message}`);
    throw new Error(frame ? `${header}
${frame}` : header);
  }
  if (ENTITY_HINT_RE.test(code))
    decodeAttributeEntities(result.program);
  return result.program;
}
function asyncInteractiveError(filename, reason, start) {
  const err = new PrunelleMistake(`prunelle compiler: async route component in ${filename} cannot use browser interactivity (${reason}). Move interactive state/handlers into a non-async component and render it from the async page.`);
  err.start = start;
  return err;
}
function isAsyncFunction(node) {
  if (node === null || node === undefined)
    return false;
  const inner = unwrapTsExpr(node);
  return (inner.type === "FunctionDeclaration" || inner.type === "FunctionExpression" || inner.type === "ArrowFunctionExpression") && inner.async === true;
}
function actionVariable(program, call) {
  let name;
  walk(program, (node) => {
    if (node.type === "VariableDeclarator" && node.init === call && node.id.type === "Identifier")
      name = node.id.name;
    return name === undefined ? undefined : false;
  });
  return name;
}
function hydrateMode(value) {
  return staticStringValue(value?.type === "JSXExpressionContainer" ? value.expression : value) ?? "*";
}
function isActionCall(node, actionLocalName, serverNamespaces) {
  if (node.type !== "CallExpression")
    return false;
  const name = calleeName(node.callee);
  return actionLocalName !== undefined && name === actionLocalName || name.endsWith(".action") && serverNamespaces.has(name.slice(0, -".action".length));
}
function scanImports(program, filename) {
  const scan = { imports: [], reactiveLocals: new Map, stateCallees: new Set, signalCallees: new Set, effectCallees: new Set, serverOnlyLocals: new Map, prunelleNamespaces: new Set, serverNamespaces: new Set, actionLocalName: undefined, usesRenderContext: false };
  for (const stmt of program.body) {
    if (stmt.type === "ExportAllDeclaration" || stmt.type === "ExportNamedDeclaration" && stmt.source !== null)
      guarded(stmt.source.start, () => assertNoKayImport(stmt.source.value, filename));
    if (stmt.type !== "ImportDeclaration")
      continue;
    guarded(stmt.source.start, () => assertNoKayImport(stmt.source.value, filename));
    if (stmt.importKind === "type")
      continue;
    const source = stmt.source.value;
    const specifiers = [];
    for (const spec of stmt.specifiers) {
      if (spec.type === "ImportSpecifier") {
        const imported = spec.importKind === "type" ? undefined : exportedName(spec.imported);
        if (imported === undefined)
          continue;
        specifiers.push({ local: spec.local.name, imported });
        scanPrunelleImport(scan, source, imported, spec.local.name, filename, spec.start);
      } else if (spec.type === "ImportDefaultSpecifier") {
        specifiers.push({ local: spec.local.name, imported: "default" });
      } else {
        specifiers.push({ local: spec.local.name, imported: "*" });
        if (PRUNELLE_SOURCES.has(source))
          scan.prunelleNamespaces.add(spec.local.name);
        if (PRUNELLE_SERVER_SOURCES.has(source))
          scan.serverNamespaces.add(spec.local.name);
      }
    }
    scan.imports.push({ source, specifiers, start: stmt.start, end: stmt.end });
  }
  return scan;
}
function scanPrunelleImport(scan, source, imported, local, filename, start) {
  if (PRUNELLE_SOURCES.has(source)) {
    if (REACTIVE_IMPORTS.has(imported))
      scan.reactiveLocals.set(local, `uses ${imported}`);
    if (imported === "island")
      guarded(start, () => {
        throw islandRemoved(filename, start);
      });
    if (STATE_PRIMITIVES.has(imported))
      scan.stateCallees.add(local);
    if (imported === "signal" || imported === "computed")
      scan.signalCallees.add(local);
    if (imported === "effect")
      scan.effectCallees.add(local);
    if (SERVER_ONLY_TAGS.has(imported))
      scan.serverOnlyLocals.set(local, imported);
  }
  if (PRUNELLE_SSR_SOURCES.has(source) && RENDER_CONTEXT_IMPORTS.has(imported))
    scan.usesRenderContext = true;
  if (PRUNELLE_SERVER_SOURCES.has(source) && imported === "action")
    scan.actionLocalName = local;
}
function scanDeclarations(program, filename, imports) {
  const scan = { localInits: new Map, exportLocals: new Map, asyncLocals: new Set, defaultLocal: undefined, hasAsyncDefault: false, hasLoadExport: false, hasPaths: false, hasPrerender: false, prerenderFalse: false, defaultHydrate: undefined, exportedActions: [], registeredActions: new Set, reexports: [], exportedNames: [] };
  const collectInits = (decl) => {
    for (const d of decl.declarations) {
      if (d.id.type === "Identifier" && d.init !== null)
        scan.localInits.set(d.id.name, d.init);
    }
  };
  const addExport = (exported, local) => {
    scan.exportedNames.push(exported);
    if (local !== undefined)
      scan.exportLocals.set(exported, local);
    if (exported === "load")
      scan.hasLoadExport = true;
    if (exported === "paths")
      scan.hasPaths = true;
  };
  for (const stmt of program.body) {
    if (stmt.type === "VariableDeclaration") {
      collectInits(stmt);
    } else if (stmt.type === "FunctionDeclaration") {
      if (stmt.async === true && stmt.id !== null)
        scan.asyncLocals.add(stmt.id.name);
    } else if (stmt.type === "ExportAllDeclaration") {
      if (stmt.exportKind !== "type")
        scan.reexports.push({ exported: "*", local: "*", source: stmt.source.value, start: stmt.start });
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const decl = unwrapTsExpr(stmt.declaration);
      const named = decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration" ? decl.id?.name : undefined;
      addExport("default", decl.type === "Identifier" ? decl.name : named ?? "default");
      if (isAsyncFunction(decl))
        scan.hasAsyncDefault = true;
      else if (decl.type === "Identifier")
        scan.defaultLocal = decl.name;
      else
        scan.localInits.set("default", decl);
    } else if (stmt.type === "ExportNamedDeclaration" && stmt.exportKind !== "type") {
      for (const spec of stmt.specifiers) {
        const exported = spec.exportKind === "type" ? undefined : exportedName(spec.exported);
        const local = exportedName(spec.local);
        if (exported === undefined || local === undefined)
          continue;
        addExport(exported, stmt.source === null ? local : undefined);
        if (stmt.source !== null)
          scan.reexports.push({ exported, local, source: stmt.source.value, start: stmt.start });
        else if (exported === "default")
          scan.defaultLocal = local;
      }
      if (stmt.declaration !== null)
        scanExportedDeclaration(scan, stmt.declaration, filename, imports, collectInits, addExport);
    }
  }
  const hydrateLocal = scan.defaultHydrate === undefined ? scan.exportLocals.get("hydrate") : undefined;
  if (hydrateLocal !== undefined)
    scan.defaultHydrate = checkExportHydrate(scan.localInits.get(hydrateLocal), filename);
  return scan;
}
function scanExportedDeclaration(scan, decl, filename, imports, collectInits, addExport) {
  if (decl.type === "FunctionDeclaration" && decl.id !== null) {
    if (decl.async === true)
      scan.asyncLocals.add(decl.id.name);
    addExport(decl.id.name, decl.id.name);
  } else if (decl.type === "ClassDeclaration" && decl.id !== null) {
    addExport(decl.id.name, decl.id.name);
  } else if (decl.type === "VariableDeclaration") {
    collectInits(decl);
    for (const d of decl.declarations) {
      if (d.id.type !== "Identifier")
        continue;
      const name = d.id.name;
      addExport(name, name);
      if (name === "prerender" && d.init?.type === "Literal") {
        if (d.init.value === true)
          scan.hasPrerender = true;
        else if (d.init.value === false)
          scan.prerenderFalse = true;
      }
      if (name === "hydrate" && d.init !== null)
        scan.defaultHydrate = checkExportHydrate(d.init, filename);
      if (d.init !== null && isActionCall(d.init, imports.actionLocalName, imports.serverNamespaces)) {
        scan.exportedActions.push(name);
        scan.registeredActions.add(d.init);
      }
    }
  }
}
function bindingUnits(program) {
  const units = [];
  const add = (node) => {
    if (node.type.startsWith("TS"))
      return;
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id !== null) {
      units.push({ name: node.id.name, node });
    } else if (node.type === "VariableDeclaration") {
      for (const d of node.declarations)
        units.push({ name: d.id.type === "Identifier" ? d.id.name : "", node: d });
    } else {
      units.push({ name: "", node });
    }
  };
  for (const stmt of program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration !== null)
        add(stmt.declaration);
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const decl = unwrapTsExpr(stmt.declaration);
      if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id !== null)
        add(decl);
      else if (decl.type !== "Identifier")
        units.push({ name: "default", node: decl });
    } else if (stmt.type !== "ImportDeclaration") {
      add(stmt);
    }
  }
  return units;
}
var TS_EXPR_WRAPPERS3 = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
function scanBody(program, filename, code, imports, decls, warnings, loadCode) {
  const body = { hasJsx: false, usesRenderContext: imports.usesRenderContext, deferredIslandTags: new Set, hydrateModes: new Set, jsxTags: new Set, dynamicImports: [], bindings: [] };
  const units = bindingUnits(program);
  const tracked = new Set(units.map((u) => u.name));
  for (const imp of imports.imports) {
    for (const spec of imp.specifiers)
      tracked.add(spec.local);
  }
  const checkActions = imports.actionLocalName !== undefined || imports.serverNamespaces.size > 0;
  const isEffect = (callee) => imports.effectCallees.has(callee) || callee.endsWith(".effect") && imports.prunelleNamespaces.has(callee.slice(0, -".effect".length));
  const ref = (binding, name, offset) => {
    if (tracked.has(name) && !binding.refs.has(name))
      binding.refs.set(name, offset);
  };
  const addMember = (binding, name, member) => {
    if (!tracked.has(name))
      return;
    const set = binding.memberRefs.get(name) ?? new Set;
    set.add(member);
    binding.memberRefs.set(name, set);
  };
  const resolveTag = (tag) => resolvePrunelleTag(tag, imports.imports);
  for (const unit of units) {
    const binding = { name: unit.name, start: unit.node.start, end: unit.node.end, fact: undefined, refs: new Map, valueRefs: new Map, memberRefs: new Map, tags: new Set, serverOnlyTag: undefined };
    body.bindings.push(binding);
    const freeIds = new Map;
    const memberObjStarts = new Set;
    walkScoped(unit.node, {
      onIdentifier(id) {
        freeIds.set(id.start, id.name);
        ref(binding, id.name, id.start);
        if (tracked.has(id.name) && !binding.valueRefs.has(id.name))
          binding.valueRefs.set(id.name, id.start);
        const reason = imports.reactiveLocals.get(id.name);
        if (reason !== undefined)
          binding.fact ??= { reason, offset: id.start };
      }
    });
    const isLoadUnit = loadCode.has(unit.node) || unit.node.type === "VariableDeclarator" && unit.node.init !== null && loadCode.has(unit.node.init);
    walk(unit.node, (node) => {
      if (node.type.startsWith("TS") && !TS_EXPR_WRAPPERS3.has(node.type))
        return false;
      if (isJsxNode(node))
        body.hasJsx = true;
      if (node.type === "JSXElement")
        checkMistakes(node, filename, code, warnings, resolveTag);
      checkHabits(node, isEffect, filename);
      if (checkActions && isActionCall(node, imports.actionLocalName, imports.serverNamespaces) && !decls.registeredActions.has(node))
        guarded(node.start, () => {
          throw mistake("action() not declared as export const", filename, `write export const ${actionVariable(program, node) ?? "name"} = ${imports.actionLocalName ?? "action"}(...) at the top level, only those get a URL`);
        });
      if (node.type === "ImportExpression" && !isLoadUnit) {
        const src = staticStringValue(node.source);
        if (src !== undefined)
          body.dynamicImports.push({ source: src, start: node.start });
      } else if (node.type === "JSXOpeningElement") {
        scanOpeningElement(node, binding, body, imports, filename);
        const root = jsxTagName(node.name).split(".")[0];
        if (isComponentTag(root))
          ref(binding, root, node.start);
      } else if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && freeIds.has(node.object.start) && node.property.type === "Identifier") {
        memberObjStarts.add(node.object.start);
        addMember(binding, node.object.name, node.property.name);
        scanPrunelleMember(node, binding, body, imports, filename);
      }
    });
    for (const [start, name] of freeIds) {
      if (!memberObjStarts.has(start))
        addMember(binding, name, "*");
    }
  }
  return body;
}
function scanOpeningElement(node, binding, body, imports, filename) {
  const tag = jsxTagName(node.name);
  const isComponent = isComponentTag(tag);
  if (isComponent) {
    body.jsxTags.add(tag);
    binding.tags.add(tag);
    binding.serverOnlyTag ??= imports.serverOnlyLocals.get(tag);
    const [ns, member] = tag.split(".");
    if (member !== undefined && imports.prunelleNamespaces.has(ns) && RENDER_CONTEXT_IMPORTS.has(member)) {
      body.usesRenderContext = true;
      if (SERVER_ONLY_TAGS.has(member))
        binding.serverOnlyTag ??= member;
    }
  }
  for (const attr of node.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier")
      continue;
    const attrName = attr.name.name;
    if (isComponent && attrName === "$hydrate") {
      const mode = hydrateMode(attr.value);
      guarded(attr.start, () => checkHydrateMode(mode, `$hydrate="${mode}"`, filename));
      body.hydrateModes.add(mode);
      if (mode !== "load")
        body.deferredIslandTags.add(tag);
    }
    if (!isComponent && tag !== "" && (EVENT_ATTR.test(attrName) || attrName === "ref"))
      binding.fact ??= { reason: `uses ${attrName}`, offset: attr.start };
  }
}
function scanPrunelleMember(node, binding, body, imports, filename) {
  if (node.computed || node.object.type !== "Identifier" || !imports.prunelleNamespaces.has(node.object.name) || node.property.type !== "Identifier")
    return;
  const member = node.property.name;
  const callee = `${node.object.name}.${member}`;
  if (member === "island")
    guarded(node.start, () => {
      throw islandRemoved(filename, node.start);
    });
  if (REACTIVE_IMPORTS.has(member))
    binding.fact ??= { reason: `calls ${callee}`, offset: node.start };
  if (STATE_PRIMITIVES.has(member))
    imports.stateCallees.add(callee);
  if (member === "signal" || member === "computed")
    imports.signalCallees.add(callee);
  if (RENDER_CONTEXT_IMPORTS.has(member))
    body.usesRenderContext = true;
}
function containsStateInit(init, callees, containers) {
  if (init === undefined)
    return false;
  const inner = unwrapTsExpr(init);
  if (inner.type === "CallExpression")
    return callees.has(calleeName(inner.callee));
  if (!containers)
    return false;
  if (inner.type === "ObjectExpression")
    return inner.properties.some((p) => p.type === "Property" && containsStateInit(p.value, callees, true));
  return inner.type === "ArrayExpression" && inner.elements.some((el) => el !== null && el.type !== "SpreadElement" && containsStateInit(el, callees, true));
}
function stateExportsOf(decls, callees, containers) {
  return [...decls.exportLocals].filter(([, local]) => containsStateInit(decls.localInits.get(local), callees, containers)).map(([exported]) => exported);
}
function analyzeModule(filename, code, program = parseTsx(filename, code)) {
  const imports = scanImports(program, filename);
  const decls = scanDeclarations(program, filename, imports);
  const warnings = [];
  const loadNodes = loadDeclarations(program);
  const body = scanBody(program, filename, code, imports, decls, warnings, new Set(loadNodes));
  checkBareSignals(program, imports.signalCallees, filename);
  if (body.hasJsx) {
    checkCompliance(program, filename, code, warnings, (tag) => resolvePrunelleTag(tag, imports.imports));
    checkBrowserGlobals(program, code, filename, warnings);
  }
  for (const [name, init] of decls.localInits) {
    if (isAsyncFunction(init))
      decls.asyncLocals.add(name);
  }
  const hasAsyncDefault = decls.hasAsyncDefault || decls.defaultLocal !== undefined && decls.asyncLocals.has(decls.defaultLocal);
  const interactivity = resolveInteractivity(body.bindings, decls.exportLocals);
  const page = interactivity.exports.get("default");
  if (hasAsyncDefault && page?.interactive === true)
    guarded(page.offset ?? 0, () => {
      throw asyncInteractiveError(filename, page.reason, page.offset);
    });
  if (interactivity.serverOnly !== undefined)
    guarded(interactivity.serverOnly.offset, () => {
      throw serverOnlyTagError(filename, interactivity.serverOnly);
    });
  const cacheExport = parseCacheExport(program);
  return {
    filename,
    program,
    warnings,
    ...interactivity,
    hasAsyncDefault,
    hasLoadExport: decls.hasLoadExport || loadNodes.length > 0,
    hasJsx: body.hasJsx,
    jsxNodes: body.hasJsx ? computeJsxNodes(program) : new WeakSet,
    hasPrerender: decls.hasPrerender,
    prerenderFalse: decls.prerenderFalse,
    ...cacheExport.spec !== undefined ? { cache: cacheExport.spec } : {},
    hasPaths: decls.hasPaths,
    usesRenderContext: body.usesRenderContext,
    defaultHydrate: decls.defaultHydrate,
    deferredIslandTags: body.deferredIslandTags,
    hydrateModes: body.hydrateModes,
    jsxTags: body.jsxTags,
    asyncLocals: decls.hasAsyncDefault ? new Set([...decls.asyncLocals, decls.exportLocals.get("default") ?? "default"]) : decls.asyncLocals,
    stateExports: stateExportsOf(decls, imports.stateCallees, true),
    signalExports: stateExportsOf(decls, imports.signalCallees, false),
    defaultDataKeys: page?.interactive === true ? analyzeDefaultDataKeys(program, decls.defaultLocal, decls.localInits) : undefined,
    exportedActions: decls.exportedActions,
    imports: imports.imports,
    dynamicImports: body.dynamicImports,
    reexports: decls.reexports,
    exportedNames: decls.exportedNames,
    bindings: body.bindings,
    exportLocals: decls.exportLocals,
    nodeEnvReads: findNodeEnvReads(program, code)
  };
}

// packages/prunelle/src/ts-plugin/fixes.ts
var PRUNELLE_CODE = {
  ERROR: 98001,
  WARNING: 98002,
  BARE_SIGNAL: 98101,
  LOWERCASE_EVENT: 98102,
  RENAMED_EVENT: 98103,
  NAMESPACED_EVENT: 98104,
  CLIENT_DIRECTIVE: 98105,
  SET_HTML: 98106,
  STRIP_NAMESPACE: 98107,
  CAMEL_ARIA: 98108,
  CAMEL_SVG: 98109,
  REACT_DEFAULT: 98110,
  BOOLEAN_FALSE_STRING: 98111,
  DANGEROUSLY_SET_HTML: 98112,
  INNER_HTML_OBJECT: 98113,
  HANDLER_MUTATION: 98114,
  DIRECTIVE: 98115,
  NON_BUBBLING_FOCUS: 98116,
  TEXT_INPUT_ONCHANGE: 98117,
  KAY_IMPORT: 98118
};
var PRUNELLE_FIXABLE_CODES = [
  PRUNELLE_CODE.BARE_SIGNAL,
  PRUNELLE_CODE.LOWERCASE_EVENT,
  PRUNELLE_CODE.RENAMED_EVENT,
  PRUNELLE_CODE.NAMESPACED_EVENT,
  PRUNELLE_CODE.CLIENT_DIRECTIVE,
  PRUNELLE_CODE.SET_HTML,
  PRUNELLE_CODE.STRIP_NAMESPACE,
  PRUNELLE_CODE.CAMEL_ARIA,
  PRUNELLE_CODE.CAMEL_SVG,
  PRUNELLE_CODE.REACT_DEFAULT,
  PRUNELLE_CODE.BOOLEAN_FALSE_STRING,
  PRUNELLE_CODE.DANGEROUSLY_SET_HTML,
  PRUNELLE_CODE.INNER_HTML_OBJECT,
  PRUNELLE_CODE.HANDLER_MUTATION,
  PRUNELLE_CODE.DIRECTIVE,
  PRUNELLE_CODE.NON_BUBBLING_FOCUS,
  PRUNELLE_CODE.TEXT_INPUT_ONCHANGE,
  PRUNELLE_CODE.KAY_IMPORT
];
var CLIENT_HYDRATE_MAP = {
  load: "load",
  visible: "visible",
  idle: "idle",
  only: "client"
};
var WRITE_PROP_RE = /^write ([a-zA-Z0-9_:-]+)=\{\.\.\.\}/;
var WRITE_IMPORT_RE = /^write '([^']+)'/;
var BUBBLING_FOCUS_RE = /focus does not bubble, write (onFocus(?:In|Out))=\{\.\.\.\}/;
function findNode(nodes, type) {
  for (const node of nodes) {
    if (node.type === type)
      return node;
  }
  return;
}
function spanOf(start, end) {
  return { start, length: Math.max(1, end - start) };
}
function attrRenameFix(code, attr, fromName, toName, fixName) {
  const span = spanOf(attr.name.start, attr.name.end);
  return {
    code,
    diagSpan: span,
    fix: { fixName, description: `Change '${fromName}' to '${toName}'`, span, newText: toName }
  };
}
function extractHtmlObjectExpr(value, source) {
  if (value?.type !== "JSXExpressionContainer" || value.expression.type === "JSXEmptyExpression")
    return;
  const obj = unwrapParens(value.expression);
  if (obj.type !== "ObjectExpression")
    return;
  const prop = obj.properties.find((p) => p.type === "Property" && (p.key.type === "Identifier" && p.key.name === "__html" || p.key.type === "Literal" && p.key.value === "__html"));
  return prop?.type === "Property" ? source.slice(prop.value.start, prop.value.end) : undefined;
}
function staticLiteralString(value) {
  if (value?.type === "Literal" && typeof value.value === "string")
    return value.value;
  if (value?.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression") {
    const inner = unwrapTsExpr(value.expression);
    if (inner.type === "Literal" && typeof inner.value === "string")
      return inner.value;
  }
  return;
}
function directiveDeleteSpan(code, start, end) {
  let delStart = start;
  let lineStart = start;
  while (lineStart > 0 && code.charCodeAt(lineStart - 1) !== 10 && code.charCodeAt(lineStart - 1) !== 13)
    lineStart--;
  if (/^[ \t]*$/.test(code.slice(lineStart, start)))
    delStart = lineStart;
  let delEnd = end;
  while (delEnd < code.length && (code.charCodeAt(delEnd) === 32 || code.charCodeAt(delEnd) === 9))
    delEnd++;
  if (code.charCodeAt(delEnd) === 13 && code.charCodeAt(delEnd + 1) === 10)
    delEnd += 2;
  else if (code.charCodeAt(delEnd) === 10)
    delEnd += 1;
  return { start: delStart, length: delEnd - delStart };
}
function classifyNamespacedAttrFix(attr, what, fixText) {
  if (attr.name.type !== "JSXNamespacedName")
    return;
  const ns = attr.name.namespace.name;
  const local = attr.name.name.name;
  if (ns === "on") {
    const match = WRITE_PROP_RE.exec(fixText);
    return match !== null ? attrRenameFix(PRUNELLE_CODE.NAMESPACED_EVENT, attr, what, match[1], "prunelle-namespaced-event") : undefined;
  }
  if (ns === "client") {
    let mode = CLIENT_HYDRATE_MAP[local];
    if (mode === undefined && local === "media") {
      const query = staticLiteralString(attr.value);
      if (query !== undefined && query.trim() !== "")
        mode = `media(${query})`;
    }
    if (mode === undefined)
      return;
    const span = spanOf(attr.start, attr.end);
    const newText = `$hydrate="${mode}"`;
    return {
      code: PRUNELLE_CODE.CLIENT_DIRECTIVE,
      diagSpan: span,
      fix: { fixName: "prunelle-client-directive", description: `Replace '${what}' with '${newText}'`, span, newText }
    };
  }
  if (what === "set:html")
    return attrRenameFix(PRUNELLE_CODE.SET_HTML, attr, "set:html", "innerHTML", "prunelle-set-html");
  if (ns === "prop" || ns === "attr" || ns === "bool")
    return attrRenameFix(PRUNELLE_CODE.STRIP_NAMESPACE, attr, what, local, "prunelle-strip-namespace");
  return;
}
function classifyInnerHtmlFix(attr, what, code) {
  const isDangerous = what === "dangerouslySetInnerHTML";
  if (!isDangerous && what !== "innerHTML={{ __html }}")
    return;
  const expr = extractHtmlObjectExpr(attr.value, code);
  if (expr === undefined)
    return;
  const span = spanOf(attr.start, attr.end);
  const newText = `innerHTML={${expr}}`;
  return {
    code: isDangerous ? PRUNELLE_CODE.DANGEROUSLY_SET_HTML : PRUNELLE_CODE.INNER_HTML_OBJECT,
    diagSpan: span,
    fix: {
      fixName: isDangerous ? "prunelle-dangerously-set-html" : "prunelle-inner-html-object",
      description: `Replace with '${newText}'`,
      span,
      newText
    }
  };
}
function classifyJsxAttrMistake(attr, what, fixText, code) {
  if (attr.name.type === "JSXNamespacedName")
    return classifyNamespacedAttrFix(attr, what, fixText);
  const attrName = attr.name.name;
  const htmlFix = classifyInnerHtmlFix(attr, what, code);
  if (htmlFix !== undefined)
    return htmlFix;
  if (fixText.includes("prunelle binds camelCase event props only")) {
    const match = WRITE_PROP_RE.exec(fixText);
    return match !== null ? attrRenameFix(PRUNELLE_CODE.LOWERCASE_EVENT, attr, attrName, match[1], "prunelle-lowercase-event") : undefined;
  }
  if (fixText.includes("ARIA attributes use kebab-case")) {
    const match = WRITE_PROP_RE.exec(fixText);
    return match !== null ? attrRenameFix(PRUNELLE_CODE.CAMEL_ARIA, attr, attrName, match[1], "prunelle-kebab-aria") : undefined;
  }
  if (fixText.includes("SVG attributes are case-sensitive") || what === "xlinkHref") {
    const target = what === "xlinkHref" ? "xlink:href" : WRITE_PROP_RE.exec(fixText)?.[1];
    return target !== undefined ? attrRenameFix(PRUNELLE_CODE.CAMEL_SVG, attr, attrName, target, "prunelle-kebab-svg") : undefined;
  }
  if (what === "defaultValue" || what === "defaultChecked") {
    const target = what === "defaultValue" ? "value" : "checked";
    return attrRenameFix(PRUNELLE_CODE.REACT_DEFAULT, attr, attrName, target, "prunelle-react-default");
  }
  if (fixText.includes("any string turns it on")) {
    const span = spanOf(attr.start, attr.end);
    const newText = `${attrName}={false}`;
    return {
      code: PRUNELLE_CODE.BOOLEAN_FALSE_STRING,
      diagSpan: span,
      fix: { fixName: "prunelle-boolean-false", description: `Change '${what}' to '${newText}'`, span, newText }
    };
  }
  if (what.includes(" runs ") && what.endsWith(" at render") && attr.value?.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression") {
    const inner = unwrapParens(attr.value.expression);
    const exprSrc = code.slice(inner.start, inner.end);
    const newText = `() => ${exprSrc}`;
    return {
      code: PRUNELLE_CODE.HANDLER_MUTATION,
      diagSpan: spanOf(attr.start, attr.end),
      fix: {
        fixName: "prunelle-wrap-handler",
        description: `Wrap handler in '${newText}'`,
        span: spanOf(attr.value.expression.start, attr.value.expression.end),
        newText
      }
    };
  }
  const focusMatch = BUBBLING_FOCUS_RE.exec(fixText);
  if (focusMatch !== null)
    return attrRenameFix(PRUNELLE_CODE.NON_BUBBLING_FOCUS, attr, attrName, focusMatch[1], "prunelle-bubbling-focus");
  if (what === attrName && attrName.startsWith("on")) {
    const match = WRITE_PROP_RE.exec(fixText);
    if (match !== null && match[1].startsWith("on"))
      return attrRenameFix(PRUNELLE_CODE.RENAMED_EVENT, attr, attrName, match[1], "prunelle-renamed-event");
  }
  return;
}
function parseMistakeParts(message, fileName) {
  const prefix = "prunelle compiler: ";
  if (!message.startsWith(prefix))
    return;
  const marker = ` in ${fileName}: `;
  const idx = message.indexOf(marker, prefix.length);
  if (idx === -1)
    return;
  const what = message.slice(prefix.length, idx);
  const rawFix = message.slice(idx + marker.length);
  const fixText = rawFix.endsWith(".") ? rawFix.slice(0, -1) : rawFix;
  return { what, fixText };
}
function classifyMistakeFix(message, fileName, nodesAtStart, code) {
  const parts = parseMistakeParts(message, fileName);
  if (parts === undefined)
    return;
  const { what, fixText } = parts;
  if (what.endsWith(" without .value")) {
    const name = what.slice(0, -" without .value".length);
    const node = name.includes(".") ? findNode(nodesAtStart, "MemberExpression") : findNode(nodesAtStart, "Identifier");
    if (node === undefined)
      return;
    const span = spanOf(node.start, node.end);
    const exprText = code.slice(node.start, node.end);
    return {
      code: PRUNELLE_CODE.BARE_SIGNAL,
      diagSpan: span,
      fix: { fixName: "prunelle-add-signal-value", description: `Add '.value' to '${name}'`, span, newText: `${exprText}.value` }
    };
  }
  if (what === "'use client'" || what === "'use server'") {
    const stmt = findNode(nodesAtStart, "ExpressionStatement");
    if (stmt === undefined)
      return;
    return {
      code: PRUNELLE_CODE.DIRECTIVE,
      diagSpan: spanOf(stmt.start, stmt.end),
      fix: {
        fixName: "prunelle-remove-directive",
        description: `Remove ${what} directive`,
        span: directiveDeleteSpan(code, stmt.start, stmt.end),
        newText: ""
      }
    };
  }
  if (what.startsWith("import from '@kayjs/")) {
    const lit = findNode(nodesAtStart, "Literal");
    const match = WRITE_IMPORT_RE.exec(fixText);
    if (lit === undefined || match === null)
      return;
    const quote = code[lit.start] === '"' ? '"' : "'";
    const replacement = match[1];
    const span = spanOf(lit.start, lit.end);
    return {
      code: PRUNELLE_CODE.KAY_IMPORT,
      diagSpan: span,
      fix: {
        fixName: "prunelle-rewrite-kay-import",
        description: `Replace import with '${replacement}'`,
        span,
        newText: `${quote}${replacement}${quote}`
      }
    };
  }
  const attr = findNode(nodesAtStart, "JSXAttribute");
  if (attr !== undefined)
    return classifyJsxAttrMistake(attr, what, fixText, code);
  return;
}
function classifyWarningFix(message, nodesAtStart) {
  if (message.includes("fires when the field loses focus, not per keystroke; write onInput={...}")) {
    const attr = findNode(nodesAtStart, "JSXAttribute");
    if (attr !== undefined)
      return attrRenameFix(PRUNELLE_CODE.TEXT_INPUT_ONCHANGE, attr, "onChange", "onInput", "prunelle-text-input-oninput");
  }
  return;
}
function toCodeFixAction(fileName, fix) {
  return {
    fixName: fix.fixName,
    description: fix.description,
    changes: [{
      fileName,
      textChanges: [{
        span: { start: fix.span.start, length: fix.span.length },
        newText: fix.newText
      }]
    }]
  };
}

// packages/prunelle/src/ts-plugin/diagnostics.ts
var PRUNELLE_DIAG_SOURCE = "prunelle";
var TS_EXT_RE = /\.[cm]?tsx?$/i;
var DTS_EXT_RE = /\.d\.[cm]?ts$/i;
var SIGNAL_HINT_RE = /\b(?:signal|computed)\b/;
var EMPTY_SET = new Set;
var REL_EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
var TOKEN_RE = /^[A-Za-z_$][\w$-]*(?::[A-Za-z_$][\w$-]*)?|^'[^'\r\n]*'|^"[^"\r\n]*"|^<[A-Za-z_$][\w$.-]*/;
var configCache = new Map;
function isCheckableFile(fileName) {
  return TS_EXT_RE.test(fileName) && !DTS_EXT_RE.test(fileName) && !isInNodeModules(fileName);
}
function propKeyName2(node) {
  if (node.type === "Identifier")
    return node.name;
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  return;
}
function staticString(node) {
  const inner = unwrapTsExpr(node);
  if (inner.type === "Literal" && typeof inner.value === "string")
    return inner.value;
  return;
}
function extractConfigObject(program) {
  for (const stmt of program.body) {
    if (stmt.type !== "ExportDefaultDeclaration")
      continue;
    const decl = unwrapTsExpr(stmt.declaration);
    if (decl.type === "ObjectExpression")
      return decl;
    if (decl.type === "CallExpression" && decl.arguments[0] !== undefined) {
      const arg = unwrapTsExpr(decl.arguments[0]);
      if (arg.type === "ObjectExpression")
        return arg;
    }
  }
  return;
}
function parseStaticCompliance(node) {
  const obj = unwrapTsExpr(node);
  if (obj.type !== "ObjectExpression")
    return;
  const out = {};
  for (const prop of obj.properties) {
    if (prop.type !== "Property")
      continue;
    const key = propKeyName2(prop.key);
    const val = unwrapTsExpr(prop.value);
    if (key === "publicBody" && val.type === "Literal" && typeof val.value === "boolean") {
      out.publicBody = val.value;
    } else if (key === "legalNotice" && val.type === "Literal" && (val.value === false || typeof val.value === "string")) {
      out.legalNotice = val.value;
    } else if (key === "ignore" && val.type === "ArrayExpression") {
      const rules = [];
      for (const el of val.elements) {
        if (el !== null && el.type !== "SpreadElement") {
          const s = staticString(el);
          if (s !== undefined)
            rules.push(s);
        }
      }
      out.ignore = rules;
    }
  }
  return out;
}
function readStaticProjectConfig(projectRoot) {
  if (projectRoot === undefined || projectRoot === "")
    return {};
  const cfgPath = import_node_path2.join(projectRoot, "prunelle.config.ts");
  if (!import_node_fs.existsSync(cfgPath))
    return {};
  let mtimeMs;
  try {
    mtimeMs = import_node_fs.statSync(cfgPath).mtimeMs;
  } catch {
    return {};
  }
  const cached = configCache.get(cfgPath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs)
    return { site: cached.site, compliance: cached.compliance };
  let site;
  let compliance;
  try {
    const code = import_node_fs.readFileSync(cfgPath, "utf8");
    const parsed = import_oxc_parser8.parseSync(cfgPath, code, { lang: "ts", sourceType: "module" });
    const obj = parsed.errors.length === 0 ? extractConfigObject(parsed.program) : undefined;
    if (obj !== undefined) {
      for (const prop of obj.properties) {
        if (prop.type !== "Property")
          continue;
        const key = propKeyName2(prop.key);
        if (key === "site")
          site = staticString(prop.value);
        else if (key === "compliance")
          compliance = parseStaticCompliance(prop.value);
      }
    }
  } catch {
    return {};
  }
  configCache.set(cfgPath, { mtimeMs, site, compliance });
  return { site, compliance };
}
function indexNodesAtOffsets(program, offsets) {
  const byOffset = new Map;
  if (offsets.size === 0)
    return byOffset;
  walk(program, (node) => {
    if (!offsets.has(node.start))
      return;
    let list = byOffset.get(node.start);
    if (list === undefined) {
      list = [];
      byOffset.set(node.start, list);
    }
    list.push(node);
  });
  return byOffset;
}
function clampSingleLine(code, start, end) {
  const safeStart = Math.max(0, Math.min(start, code.length));
  const safeEnd = Math.max(safeStart, Math.min(end, code.length));
  const nl = code.indexOf(`
`, safeStart);
  const effectiveEnd = nl !== -1 && nl < safeEnd ? nl : safeEnd;
  return { start: safeStart, length: Math.max(1, effectiveEnd - safeStart) };
}
function spanFromNodes(nodes, code, start) {
  for (const node of nodes) {
    if (node.type === "JSXAttribute")
      return clampSingleLine(code, node.start, node.end);
    if (node.type === "JSXElement") {
      const opening = node.openingElement;
      const hasNewline = code.slice(opening.start, opening.end).includes(`
`);
      return clampSingleLine(code, opening.start, hasNewline ? opening.name.end : opening.end);
    }
    if (node.type === "JSXOpeningElement") {
      const hasNewline = code.slice(node.start, node.end).includes(`
`);
      return clampSingleLine(code, node.start, hasNewline ? node.name.end : node.end);
    }
    if (node.type === "ImportSpecifier" || node.type === "ExpressionStatement" || node.type === "Literal" || node.type === "MemberExpression" || node.type === "Identifier" || node.type === "CallExpression" || node.type === "VariableDeclarator")
      return clampSingleLine(code, node.start, node.end);
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression")
      return clampSingleLine(code, node.start, node.end);
  }
  const safeStart = Math.max(0, Math.min(start, Math.max(0, code.length - 1)));
  const match = TOKEN_RE.exec(code.slice(safeStart));
  const length = match !== null ? match[0].length : Math.min(1, Math.max(0, code.length - safeStart));
  return { start: safeStart, length: Math.max(1, length) };
}
function normalizeDisplayPath(fileName, projectRoot) {
  if (projectRoot === undefined || projectRoot === "")
    return fileName;
  const rel = relPosix(projectRoot, fileName);
  return rel !== "" ? rel : fileName;
}
function mergeCompliance(base, override) {
  if (base === undefined)
    return override;
  if (override === undefined)
    return base;
  return {
    ignore: override.ignore ?? base.ignore,
    publicBody: override.publicBody ?? base.publicBody,
    legalNotice: override.legalNotice ?? base.legalNotice
  };
}
function resolveRelativeSource(fromFile, specifier, readFile) {
  const base = import_node_path2.resolve(import_node_path2.dirname(fromFile), specifier);
  const stripped = base.replace(/\.[cm]?js$/i, "");
  for (const ext of REL_EXTS) {
    const candidate = `${stripped}${ext}`;
    if (!TS_EXT_RE.test(candidate))
      continue;
    const code = readFile(candidate);
    if (code !== undefined)
      return { path: candidate, code };
  }
  return;
}
function collectImportedSignalMistakes(fileName, program, imports, readFile) {
  if (readFile === undefined)
    return [];
  const importedSignals = new Set;
  const importedSignalMembers = new Map;
  for (const imp of imports) {
    if (!imp.source.startsWith("./") && !imp.source.startsWith("../"))
      continue;
    const resolved = resolveRelativeSource(fileName, imp.source, readFile);
    if (resolved === undefined || !SIGNAL_HINT_RE.test(resolved.code))
      continue;
    let depProgram;
    try {
      depProgram = parseTsx(resolved.path, resolved.code);
    } catch {
      continue;
    }
    const { value: dep } = collectMistakes(() => analyzeModule(resolved.path, resolved.code, depProgram));
    if (dep === undefined || dep.signalExports.length === 0)
      continue;
    const exported = new Set(dep.signalExports);
    for (const spec of imp.specifiers) {
      if (spec.imported === "*") {
        importedSignalMembers.set(spec.local, exported);
      } else if (exported.has(spec.imported)) {
        importedSignals.add(spec.local);
      }
    }
  }
  if (importedSignals.size === 0 && importedSignalMembers.size === 0)
    return [];
  return collectMistakes(() => checkBareSignals(program, EMPTY_SET, fileName, importedSignals, importedSignalMembers)).mistakes;
}
function collectPrunelleDiagnostics(fileName, code, options = {}) {
  if (!isCheckableFile(fileName))
    return [];
  let program;
  try {
    program = parseTsx(fileName, code);
  } catch {
    return [];
  }
  const { value, mistakes, error } = collectMistakes(() => analyzeModule(fileName, code, program));
  const allMistakes = [...mistakes];
  if (error instanceof PrunelleMistake)
    allMistakes.push(error);
  if (value !== undefined)
    allMistakes.push(...collectImportedSignalMistakes(fileName, program, value.imports, options.readFile));
  const staticCfg = options.compliance !== undefined && options.site !== undefined ? {} : readStaticProjectConfig(options.projectRoot);
  const compliance = mergeCompliance(staticCfg.compliance, options.compliance);
  const site = options.site ?? staticCfg.site;
  const activeWarnings = (value?.warnings ?? []).filter((w) => shouldEmitWarning(w, compliance, site));
  if (allMistakes.length === 0 && activeWarnings.length === 0)
    return [];
  const offsets = new Set;
  for (const m of allMistakes)
    offsets.add(m.start ?? 0);
  for (const w of activeWarnings)
    offsets.add(w.start);
  const nodesByOffset = indexNodesAtOffsets(program, offsets);
  const displayFile = normalizeDisplayPath(fileName, options.projectRoot);
  const items = [];
  for (const m of allMistakes) {
    const start = m.start ?? 0;
    const nodes = nodesByOffset.get(start) ?? [];
    const classified = classifyMistakeFix(m.message, fileName, nodes, code);
    const span = classified?.diagSpan ?? spanFromNodes(nodes, code, start);
    items.push({
      code: classified?.code ?? PRUNELLE_CODE.ERROR,
      category: "error",
      start: span.start,
      length: span.length,
      message: m.message.replaceAll(fileName, displayFile),
      ...classified !== undefined ? { fix: classified.fix } : {}
    });
  }
  for (const w of activeWarnings) {
    const nodes = nodesByOffset.get(w.start) ?? [];
    const classified = classifyWarningFix(w.message, nodes);
    const span = classified?.diagSpan ?? spanFromNodes(nodes, code, w.start);
    items.push({
      code: classified?.code ?? PRUNELLE_CODE.WARNING,
      category: "warning",
      start: span.start,
      length: span.length,
      message: w.message.replaceAll(fileName, displayFile),
      ...classified !== undefined ? { fix: classified.fix } : {}
    });
  }
  return items;
}
function toTsDiagnostic(tsLib, item, sourceFile) {
  return {
    file: sourceFile,
    start: item.start,
    length: item.length,
    messageText: item.message,
    category: item.category === "warning" ? tsLib.DiagnosticCategory.Warning : tsLib.DiagnosticCategory.Error,
    code: item.code,
    source: PRUNELLE_DIAG_SOURCE
  };
}

// packages/prunelle/src/ts-plugin/index.ts
var MAX_CACHE_ENTRIES = 200;
function readPluginConfig(raw) {
  if (raw === null || typeof raw !== "object")
    return {};
  const rec = raw;
  const site = typeof rec.site === "string" ? rec.site : undefined;
  const compliance = rec.compliance !== null && typeof rec.compliance === "object" ? rec.compliance : undefined;
  return { site, compliance };
}
function registerSupportedCodeFixes(tsLib) {
  if (typeof tsLib.getSupportedCodeFixes !== "function")
    return;
  try {
    const supported = tsLib.getSupportedCodeFixes();
    if (!Array.isArray(supported) || Object.isFrozen(supported))
      return;
    const existing = new Set(supported);
    for (const code of PRUNELLE_FIXABLE_CODES) {
      const str = String(code);
      if (!existing.has(str))
        supported.push(str);
    }
  } catch {
    return;
  }
}
function readFileSource(prior, host, fileName) {
  const sourceFile = prior.getProgram()?.getSourceFile(fileName);
  if (sourceFile !== undefined)
    return { sourceFile, text: sourceFile.text };
  const snapshot = host.getScriptSnapshot(fileName);
  if (snapshot !== undefined)
    return { sourceFile: undefined, text: snapshot.getText(0, snapshot.getLength()) };
  return { sourceFile: undefined, text: undefined };
}
function getPrunelleDiagnostics(tsLib, fileName, code, options = {}, sourceFile) {
  return collectPrunelleDiagnostics(fileName, code, options).map((item) => toTsDiagnostic(tsLib, item, sourceFile));
}
function getPrunelleCodeFixes(fileName, code, start, end, errorCodes, options = {}) {
  const items = collectPrunelleDiagnostics(fileName, code, options);
  return selectCodeFixes(fileName, items, start, end, errorCodes);
}
function selectCodeFixes(fileName, items, start, end, errorCodes) {
  const out = [];
  for (const item of items) {
    if (item.fix === undefined)
      continue;
    if (errorCodes.length > 0 && !errorCodes.includes(item.code))
      continue;
    const itemEnd = item.start + item.length;
    if (item.start <= end && start <= itemEnd)
      out.push(toCodeFixAction(fileName, item.fix));
  }
  return out;
}
function createPrunellePlugin(tsLib, info) {
  const prior = info.languageService;
  const log = (msg) => {
    info.project?.projectService?.logger?.info(`[prunelle/ts-plugin] ${msg}`);
  };
  registerSupportedCodeFixes(tsLib);
  const cache = new Map;
  const pluginCfg = readPluginConfig(info.config);
  const readFile = (path) => readFileSource(prior, info.languageServiceHost, path).text;
  const getOptions = () => ({
    projectRoot: typeof info.project?.getCurrentDirectory === "function" ? info.project.getCurrentDirectory() : undefined,
    compliance: pluginCfg.compliance,
    site: pluginCfg.site,
    readFile
  });
  const getItems = (fileName) => {
    if (!isCheckableFile(fileName))
      return { sourceFile: undefined, items: [] };
    const { sourceFile, text } = readFileSource(prior, info.languageServiceHost, fileName);
    if (text === undefined)
      return { sourceFile, items: [] };
    const projectVersion = typeof info.languageServiceHost.getProjectVersion === "function" ? info.languageServiceHost.getProjectVersion() : "";
    const cached = cache.get(fileName);
    if (cached !== undefined && cached.text === text && cached.projectVersion === projectVersion)
      return { sourceFile, items: cached.items };
    try {
      const items = collectPrunelleDiagnostics(fileName, text, getOptions());
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined)
          cache.delete(oldest);
      }
      cache.set(fileName, { text, projectVersion, items });
      return { sourceFile, items };
    } catch (err) {
      log(`analysis failed for ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
      return { sourceFile, items: [] };
    }
  };
  const proxy = Object.create(null);
  for (const key of Object.keys(prior)) {
    const member = prior[key];
    if (typeof member === "function") {
      proxy[key] = (...args) => member.apply(prior, args);
    }
  }
  proxy.getSemanticDiagnostics = (fileName) => {
    const base = prior.getSemanticDiagnostics(fileName);
    const { sourceFile, items } = getItems(fileName);
    if (items.length === 0)
      return base;
    return [...base, ...items.map((item) => toTsDiagnostic(tsLib, item, sourceFile))];
  };
  proxy.getCodeFixesAtPosition = (fileName, start, end, errorCodes, formatOptions, preferences) => {
    const base = prior.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, preferences);
    const { items } = getItems(fileName);
    if (items.length === 0)
      return base;
    const prunelleFixes = selectCodeFixes(fileName, items, start, end, errorCodes);
    return prunelleFixes.length === 0 ? base : [...base, ...prunelleFixes];
  };
  return proxy;
}
function init(modules) {
  const tsLib = modules.typescript;
  return {
    create(info) {
      return createPrunellePlugin(tsLib, info);
    }
  };
}
var ts_plugin_default = init;


;(function () {
  const exported = module.exports;
  if (exported && typeof exported.default === 'function') {
    const factory = exported.default;
    for (const key of Object.keys(exported)) {
      if (key !== 'default' && !(key in factory))
        factory[key] = exported[key];
    }
    factory.default = factory;
    module.exports = factory;
  }
})();
