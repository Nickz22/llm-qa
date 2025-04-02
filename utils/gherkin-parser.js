const parseGherkinToXml = (description) => {
  let finalXml = '<?xml version="1.0" encoding="UTF-8"?>';

  // Pre-clean: Remove text within parentheses
  const cleanedDescription = description.replace(/\([^)]*\)/g, "");

  // Find the first actual "given" statement
  const firstGivenMatch = cleanedDescription.match(/\bgiven\b\s+[^()\n]+/i);
  if (!firstGivenMatch) {
    throw new Error("No 'given' statement found in description");
  }

  // Find the last "then" or "and" statement
  const allThenAndMatches = [...cleanedDescription.matchAll(/\b(then|and)\b\s+[^()\n]+/gi)];
  if (allThenAndMatches.length === 0) {
    throw new Error("No 'then' or 'and' statements found in description");
  }
  const lastThenOrAnd = allThenAndMatches[allThenAndMatches.length - 1];

  // Extract the relevant BDD content
  const startIndex = firstGivenMatch.index;
  const endIndex = lastThenOrAnd.index + lastThenOrAnd[0].length;
  const relevantContent = cleanedDescription.substring(startIndex, endIndex);

  // Split into use cases based on "given" statements within the relevant content
  const useCases = relevantContent.split(/(?=\bgiven\b)/i).filter(Boolean);

  for (const useCase of useCases) {
    const steps = [];
    let currentKeyword = "";
    let currentStep = "";

    // Process each use case
    const tokens = useCase.split(/(Given|When|Then|And)/i).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      if (/^(Given|When|Then|And)$/i.test(token)) {
        if (currentStep && currentKeyword) {
          steps.push({ keyword: currentKeyword, text: currentStep.trim() });
        }
        currentKeyword = token;
        currentStep = "";
      } else {
        currentStep += token;
      }
    }

    if (currentStep && currentKeyword) {
      steps.push({ keyword: currentKeyword, text: currentStep.trim() });
    }

    // Only create a test case if we have valid steps
    if (steps.length > 0) {
      const xmlSteps = steps
        .map((step) => {
          const cleanText = step.text.replace(/"/g, "&quot;");
          return '    <step type="' + step.keyword.toLowerCase() + '">' + cleanText + "</step>";
        })
        .join("\n");

      finalXml += "\n<testcase>\n" + xmlSteps + "\n</testcase>";
    }
  }

  return finalXml;
};

const countExpectedActions = (xmlContent) => {
  const allSteps = xmlContent.match(/<step type="(when|then|and)">/gi) || [];
  let count = 0;
  let countingMode = false;

  for (const step of allSteps) {
    const stepType = step.toLowerCase();
    if (stepType.includes("when")) {
      countingMode = true;
      count++;
    } else if (stepType.includes("then")) {
      countingMode = false;
    } else if (stepType.includes("and") && countingMode) {
      count++;
    }
  }

  if (count === 0) {
    throw new Error("No 'when' step found in test case");
  }

  return count;
};

module.exports = { parseGherkinToXml, countExpectedActions };
