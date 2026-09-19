# Accessibility

Accessibility is part of the product contract, not a post-release check.

The web application provides keyboard navigation, a skip link, labelled controls, visible validation errors, live status updates, language-aware English/Hindi content, and reduced-motion-friendly presentation. Automated accessibility scenarios run through Playwright and axe.

When changing UI, preserve:

- a logical heading and focus order;
- accessible names for every interactive control;
- programmatic association between errors and fields;
- keyboard access without pointer-only interactions;
- readable contrast and zoom-friendly layout;
- `lang` updates when switching between English and Hindi.

Report an accessibility issue with the route, language, browser, assistive technology (if applicable), and the shortest reproduction path.
