class DateValidator {
  constructor() {
    this.localePatterns = {
      de_DE: /^\d{2}\.\d{2}\.\d{4}$/, // DD.MM.YYYY
      en_US: /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
      fr_FR: /^\d{2}\/\d{2}\/\d{4}$/ // DD/MM/YYYY
    };
  }

  validateDatesInHtml(html, locale) {
    if (!this.localePatterns[locale]) {
      throw new Error(`Holy shit Morty, what kind of locale is "${locale}"? Never heard of it!`);
    }

    const datePattern = this.localePatterns[locale];
    const dateRegex = /\b\d{2}[./]\d{2}[./]\d{4}\b/g;
    const dates = html.match(dateRegex) || [];

    const invalidDates = dates.filter((date) => !date.match(datePattern));

    if (invalidDates.length > 0) {
      throw new Error(`These dates are wrong, Morty! They're all wrong!: ${invalidDates.join(", ")}`);
    }

    return true;
  }
}

module.exports = DateValidator;
