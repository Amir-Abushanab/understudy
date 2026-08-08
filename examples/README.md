# examples

These are **authored** motion languages for **invented** brands: they show what a
well-formed `motion` block looks like and give the validator something to chew on.
Nothing here is captured from a real site, by design (see `understudy-spec.md`
sections 1 and 14):

- No brand-named, extracted artifacts ship here, ever.
- The tool extracts only from URLs a user supplies at run time. No corpus, no index.
- Measured timings from a site the user named are uncopyrightable facts; a
  checked-in pack lifted from a real brand is not, and is out of bounds.

## Adding an example

1. Create a folder named for your invented brand, for example
   `examples/lumen/`.
2. Add a `design-model.yaml` with a `motion:` block authored by hand. It must
   satisfy the contract in `understudy-spec.md` section 5: `semantic` entries
   reference `primitives` by name, `meta.confidence` is present, every token has
   provenance, and there are no em-dashes in prose fields.
3. Validate it:

   ```bash
   node scripts/validate.mjs ./examples/lumen/design-model.yaml
   ```

   Fix anything the validator flags. Exit code 0 means it is well formed.

4. If you want to demonstrate a real capture, record a terminal session or a
   short screen capture in your pull request and link it. Do not commit a
   captured pack for a real brand.

## Demonstrating capture

The honest way to show understudy working is a README recording of a live run
against a site the demonstrator owns or has chosen, not a checked-in output file.
The fixtures under `fixtures/` already provide known-good pages you can capture
locally:

```bash
node dist/index.js capture "file://$(pwd)/fixtures/stagger-120ms/index.html" \
  --ignore-robots --settle 1500 -o /tmp/motion.yaml
node scripts/validate.mjs /tmp/motion.yaml
```
