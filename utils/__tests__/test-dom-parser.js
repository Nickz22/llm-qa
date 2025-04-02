const fs = require("fs");
const path = require("path");
const { extractContentByTag } = require("../dom-parser");

describe("DOM Parser", () => {
  let testDomContent;

  beforeAll(() => {
    testDomContent = fs.readFileSync(path.join(__dirname, "../../temp/testDom.txt"), "utf8");
    // Log the first 500 characters to see what we're working with
    console.log("First 500 chars of DOM content:", testDomContent.substring(0, 500));

    // Check if the tag exists in the content
    const hasTag = testDomContent.includes("strk-st-dispatch-central");
    console.log("Tag exists in content:", hasTag);

    // Find the index of the tag
    const tagIndex = testDomContent.indexOf("strk-st-dispatch-central");
    if (tagIndex !== -1) {
      // Log 100 characters before and after the tag position
      console.log("Content around tag:", testDomContent.substring(Math.max(0, tagIndex - 100), tagIndex + 100));
    }
  });

  test("extracts content within strk-st-dispatch-central tag", () => {
    const result = extractContentByTag(testDomContent, "strk-st-dispatch-central");

    // Basic validations
    expect(result).toBeTruthy();
    expect(result).toContain("<strk-st-dispatch-central");
    expect(result).toContain("</strk-st-dispatch-central>");

    // Make sure we got the complete tag content
    const openingTagCount = (result.match(/<strk-st-dispatch-central/g) || []).length;
    const closingTagCount = (result.match(/<\/strk-st-dispatch-central>/g) || []).length;
    expect(openingTagCount).toBe(closingTagCount);

    // Log the result for inspection
    console.log("Extracted content:", result);
  });

  test("returns null for non-existent tag", () => {
    const result = extractContentByTag(testDomContent, "non-existent-tag");
    expect(result).toBeNull();
  });
});
