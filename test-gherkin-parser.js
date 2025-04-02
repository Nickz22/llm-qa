const { parseGherkinToXml, countExpectedActions } = require("./utils/gherkin-parser");

describe("Gherkin Parser Tests", () => {
  test("should correctly count actions for auto-scheduling use case", () => {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<testcase>
    <step type="given">unscheduled jobs on Dispatch Central</step>
    <step type="when">I click the Auto Schedule button</step>
    <step type="then">all unscheduled jobs are scheduled</step>
    <step type="and">each resource is assigned at least one job</step>
</testcase>`;

    const expectedActionCount = 3; // when + then + and
    const actualActionCount = countExpectedActions(xmlContent);
    expect(actualActionCount).toBe(expectedActionCount);
  });

  test("should correctly count actions for maintenance profile use case", () => {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<testcase>
    <step type="given">a user is on a Maintenance Profile record</step>
    <step type="when">the user clicks Edit</step>
    <step type="and">the user selects a Floating Schedule Type</step>
    <step type="and">the user clicks Save</step>
    <step type="and">the user reloads the page</step>
    <step type="then">the Floating option is visibly selected</step>
</testcase>`;

    const expectedActionCount = 5; // when + 3 ands + then
    const actualActionCount = countExpectedActions(xmlContent);
    expect(actualActionCount).toBe(expectedActionCount);
  });

  test("should throw error when no when step is found", () => {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<testcase>
    <step type="given">some precondition</step>
    <step type="then">some result</step>
</testcase>`;

    expect(() => countExpectedActions(xmlContent)).toThrow("No 'when' step found in test case");
  });

  test("should handle case-insensitive step types", () => {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<testcase>
    <step type="GIVEN">some precondition</step>
    <step type="When">first action</step>
    <step type="THEN">first check</step>
    <step type="AND">second check</step>
</testcase>`;

    const expectedActionCount = 3; // when + then + and
    const actualActionCount = countExpectedActions(xmlContent);
    expect(actualActionCount).toBe(expectedActionCount);
  });
});
