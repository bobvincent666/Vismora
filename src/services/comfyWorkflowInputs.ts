/** Expand ComfyUI V3 autogrow groups into their serialized API input names. */
export function missingComfyRequiredInputs(
  required: Record<string, unknown>,
  inputs: Record<string, unknown>
): string[] {
  const missing: string[] = []
  for (const [name, spec] of Object.entries(required)) {
    if (Array.isArray(spec) && spec[0] === 'COMFY_AUTOGROW_V3') {
      const template = spec[1]?.template
      if (template && Number.isInteger(template.min) && template.min >= 0) {
        const names: unknown[] | undefined = Array.isArray(template.names)
          ? template.names
          : typeof template.prefix === 'string' && Number.isInteger(template.max) && template.max >= 0
            ? Array.from({ length: template.max }, (_, index) => `${template.prefix}${index}`)
            : undefined
        if (names && names.every((child) => typeof child === 'string')) {
          // ComfyUI requires the first `min` children, not the group container.
          // An optional template has no required children, even when min > 0.
          const childRequired = Object.keys(template.input?.required ?? {}).length > 0
          if (childRequired) {
            for (const child of names.slice(0, template.min)) {
              const key = `${name}.${child}`
              if (!(key in inputs)) missing.push(key)
            }
          }
          continue
        }
      }
    }
    if (!(name in inputs)) missing.push(name)
  }
  return missing
}
