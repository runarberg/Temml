import ParseError from "./ParseError.js"
import { postProcess } from "./postProcess.js";

const findEndOfMath = function(delimiter, text, startIndex) {
  // Adapted from
  // https://github.com/Khan/perseus/blob/master/src/perseus-markdown.jsx
  let index = startIndex;
  let braceLevel = 0;

  const delimLength = delimiter.length;

  while (index < text.length) {
    const character = text[index];

    if (braceLevel <= 0 && text.slice(index, index + delimLength) === delimiter) {
      return index;
    } else if (character === "\\") {
      index++;
    } else if (character === "{") {
      braceLevel++;
    } else if (character === "}") {
      braceLevel--;
    }

    index++;
  }

  return -1;
};

const escapeRegex = function(string) {
  return string.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
};

const amsRegex = /^\\(?:begin|(?:eq)?ref){/

const splitAtDelimiters = function(text, delimiters) {
  let index;
  const data = [];

  const regexLeft = new RegExp(
    "(" + delimiters.map((x) => escapeRegex(x.left)).join("|") + ")"
  )

  while (true) {
    index = text.search(regexLeft);
    if (index === -1) {
      break;
    }
    if (index > 0) {
      data.push({
        type: "text",
        data: text.slice(0, index)
      });
      text = text.slice(index); // now text starts with delimiter
    }
    // ... so this always succeeds:
    const i = delimiters.findIndex((delim) => text.startsWith(delim.left));
    index = findEndOfMath(delimiters[i].right, text, delimiters[i].left.length);
    if (index === -1) {
      break;
    }
    const rawData = text.slice(0, index + delimiters[i].right.length);
    const math = amsRegex.test(rawData)
      ? rawData
      : text.slice(delimiters[i].left.length, index);
    data.push({
      type: "math",
      data: math,
      rawData,
      display: delimiters[i].display
    });
    text = text.slice(index + delimiters[i].right.length);
  }

  if (text !== "") {
    data.push({
      type: "text",
      data: text
    });
  }

  return data;
};

const defaultDelimiters = [
  { left: "$$", right: "$$", display: true },
  { left: "\\(", right: "\\)", display: false },
  // LaTeX uses $…$, but it ruins the display of normal `$` in text:
  // {left: "$", right: "$", display: false},
  // $ must come after $$

  // Render AMS environments even if outside $$…$$ delimiters.
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{align*}", right: "\\end{align*}", display: true },
  { left: "\\begin{alignat}", right: "\\end{alignat}", display: true },
  { left: "\\begin{alignat*}", right: "\\end{alignat*}", display: true },
  { left: "\\begin{gather}", right: "\\end{gather}", display: true },
  { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
  { left: "\\begin{CD}", right: "\\end{CD}", display: true },
  // Ditto \ref & \eqref
  { left: "\\ref{", right: "}", display: false },
  { left: "\\eqref{", right: "}", display: false },

  { left: "\\[", right: "\\]", display: true }
];

const firstDraftDelimiters = {
  "$": [
         { left: "$$", right: "$$", display: true },
         { left: "$`", right: "`$", display: false },
         { left: "$", right: "$", display: false }
  ],
  "(": [
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false }
  ]
}

const amsDelimiters = [
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{align*}", right: "\\end{align*}", display: true },
  { left: "\\begin{alignat}", right: "\\end{alignat}", display: true },
  { left: "\\begin{alignat*}", right: "\\end{alignat*}", display: true },
  { left: "\\begin{gather}", right: "\\end{gather}", display: true },
  { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
  { left: "\\begin{CD}", right: "\\end{CD}", display: true },
  { left: "\\ref{", right: "}", display: false },
  { left: "\\eqref{", right: "}", display: false }
];

const delimitersFromKey = key => {
  if (key === "$" || key === "(") {
    return firstDraftDelimiters[key];
  } else if (key === "$+" || key === "(+") {
    const firstDraft = firstDraftDelimiters[key.slice(0, 1)];
    return firstDraft.concat(amsDelimiters)
  } else if (key === "ams") {
    return amsDelimiters
  } else if (key === "all") {
    return (firstDraftDelimiters["("]).concat(firstDraftDelimiters["$"]).concat(amsDelimiters)
  } else {
    return defaultDelimiters
  }
}

/* Note: optionsCopy is mutated by this method. If it is ever exposed in the
 * API, we should copy it before mutating.
 */
const renderMathInText = function(text, optionsCopy) {
  const data = splitAtDelimiters(text, optionsCopy.delimiters);
  if (data.length === 1 && data[0].type === "text") {
    // There is no formula in the text.
    // Let's return null which means there is no need to replace
    // the current text node with a new one.
    return null;
  }

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < data.length; i++) {
    if (data[i].type === "text") {
      fragment.appendChild(document.createTextNode(data[i].data));
    } else {
      const span = document.createElement("span");
      let math = data[i].data;
      // Override any display mode defined in the settings with that
      // defined by the text itself
      optionsCopy.displayMode = data[i].display;
      try {
        if (optionsCopy.preProcess) {
          math = optionsCopy.preProcess(math);
        }
        // Importing render() from temml.js would be a circular dependency.
        // So call the global version.
        // eslint-disable-next-line no-undef
        temml.render(math, span, optionsCopy);
      } catch (e) {
        if (!(e instanceof ParseError)) {
          throw e;
        }
        optionsCopy.errorCallback(
          "Temml auto-render: Failed to parse `" + data[i].data + "` with ",
          e
        );
        fragment.appendChild(document.createTextNode(data[i].rawData));
        continue;
      }
      fragment.appendChild(span);
    }
  }

  return fragment;
};

const renderElem = function(elem, optionsCopy) {
  for (let i = 0; i < elem.childNodes.length; i++) {
    const childNode = elem.childNodes[i];
    if (childNode.nodeType === 3) {
      // Text node
      const frag = renderMathInText(childNode.textContent, optionsCopy);
      if (frag) {
        i += frag.childNodes.length - 1;
        elem.replaceChild(frag, childNode);
      }
    } else if (childNode.nodeType === 1) {
      // Element node
      const className = " " + childNode.className + " ";
      const shouldRender =
        optionsCopy.ignoredTags.indexOf(childNode.nodeName.toLowerCase()) === -1 &&
        optionsCopy.ignoredClasses.every((x) => className.indexOf(" " + x + " ") === -1);

      if (shouldRender) {
        renderElem(childNode, optionsCopy);
      }
    }
    // Otherwise, it's something else, and ignore it.
  }
};

export const renderMathInElement = function(elem, options) {
  if (!elem) {
    throw new Error("No element provided to render");
  }

  const optionsCopy = {};

  // Object.assign(optionsCopy, option)
  for (const option in options) {
    if (Object.prototype.hasOwnProperty.call(options, option)) {
      optionsCopy[option] = options[option];
    }
  }

  if (optionsCopy.fences) {
    optionsCopy.delimiters = delimitersFromKey(optionsCopy.fences);
  } else {
    optionsCopy.delimiters = optionsCopy.delimiters || defaultDelimiters
  }
  optionsCopy.ignoredTags = optionsCopy.ignoredTags || [
    "script",
    "noscript",
    "style",
    "textarea",
    "pre",
    "code",
    "option"
  ];
  optionsCopy.ignoredClasses = optionsCopy.ignoredClasses || [];
  // eslint-disable-next-line no-console
  optionsCopy.errorCallback = optionsCopy.errorCallback || console.error;

  // Enable sharing of global macros defined via `\gdef` between different
  // math elements within a single call to `renderMathInElement`.
  optionsCopy.macros = optionsCopy.macros || {};

  renderElem(elem, optionsCopy);
  postProcess(elem);
};
