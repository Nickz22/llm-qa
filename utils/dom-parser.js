/**
 * Extracts HTML content within a specific tag, handling nested tags of the same type.
 * Uses simple string manipulation to avoid heavy XML/DOM parsing.
 *
 * @param {string} content - The HTML content to parse
 * @param {string} tag - The tag name to extract content from
 * @returns {string|null} - The content within the tag, including the tag itself, or null if not found
 */
function extractContentByTag(content, tag) {
  // Create regex patterns - simplified opening tag pattern
  const openingTagPattern = new RegExp(`<${tag}`);
  const closingTagPattern = new RegExp(`</${tag}>`);

  // Find the first opening tag
  const startMatch = content.match(openingTagPattern);
  if (!startMatch) {
    return null;
  }
  const startIndex = startMatch.index;

  // Find the matching closing tag by counting nested tags
  let endIndex = -1;
  let depth = 1; // Start at 1 since we found the first opening tag
  let searchIndex = startIndex + startMatch[0].length;

  while (searchIndex < content.length) {
    // Find next opening and closing tags
    const remainingContent = content.slice(searchIndex);
    const nextOpeningMatch = remainingContent.match(openingTagPattern);
    const nextClosingMatch = remainingContent.match(closingTagPattern);

    const nextOpeningIndex = nextOpeningMatch ? searchIndex + nextOpeningMatch.index : content.length + 1;
    const nextClosingIndex = nextClosingMatch ? searchIndex + nextClosingMatch.index : content.length + 1;

    // No more tags found
    if (nextOpeningIndex === content.length + 1 && nextClosingIndex === content.length + 1) {
      console.log("No more tags found");
      return null;
    }

    // Process the next tag (whichever comes first)
    if (nextOpeningIndex < nextClosingIndex) {
      depth++;
      searchIndex = nextOpeningIndex + nextOpeningMatch[0].length;
    } else {
      depth--;
      if (depth === 0) {
        endIndex = nextClosingIndex + nextClosingMatch[0].length;
        break;
      }
      searchIndex = nextClosingIndex + nextClosingMatch[0].length;
    }
  }

  if (endIndex === -1) {
    console.log("No matching end tag found");
    return null;
  }

  const result = content.substring(startIndex, endIndex);
  console.log("Extracted content length:", result.length);
  return result;
}

module.exports = {
  extractContentByTag
};
