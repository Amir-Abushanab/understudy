# examples

These are **authored** motion languages for **invented** brands. They exist to
show what a well-formed `motion` block looks like and to give the validator
something to chew on. They are not captured from any real site.

This is a deliberate posture, not an accident (see `understudy-spec.md` sections
1 and 14):

- understudy ships **no** brand-named, extracted artifacts. There is no
  `airbnb-motion.yaml` here and never will be.
- The tool extracts only from URLs a user supplies at run time. It hosts no
  corpus and indexes nothing.
- Measured timings from a site the user named are uncopyrightable facts. A
  checked-in pack lifted from a real brand is a different thing, and it is out of
  bounds.

So the examples are the Hue model: original motion languages, invented for the
purpose, authored by hand.

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
