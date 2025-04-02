const prettier = require("prettier");

async function extractHtml(tag, domContent) {
  const startTag = `<${tag}`;
  const endTag = `</${tag}>`;

  const startIndex = domContent.indexOf(startTag);
  if (startIndex === -1) {
    throw new Error(`Could not find element with tag: ${tag}`);
  }

  // Find the matching end tag by counting nested tags
  let depth = 1;
  let searchIndex = startIndex + startTag.length;
  let endIndex = -1;

  while (depth > 0 && searchIndex < domContent.length) {
    const nextStart = domContent.indexOf(startTag, searchIndex);
    const nextEnd = domContent.indexOf(endTag, searchIndex);

    if (nextEnd === -1) {
      throw new Error(`Malformed HTML: Missing closing tag for ${tag}`);
    }

    if (nextStart !== -1 && nextStart < nextEnd) {
      depth++;
      searchIndex = nextStart + startTag.length;
    } else {
      depth--;
      if (depth === 0) {
        endIndex = nextEnd + endTag.length;
      }
      searchIndex = nextEnd + endTag.length;
    }
  }

  if (endIndex === -1) {
    throw new Error(`Could not find matching end tag for ${tag}`);
  }

  const extractedContent = domContent.slice(startIndex, endIndex);

  return prettier.format(extractedContent, {
    parser: "html",
    printWidth: 120
  });
}

module.exports = { extractHtml };
