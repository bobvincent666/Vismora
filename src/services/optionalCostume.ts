type WorkflowNode = { class_type: string; inputs: Record<string, any>; _meta?: { title?: string; optionalReference?: string } }
type Workflow = Record<string, WorkflowNode>

export function isOptionalWomensCostume(workflowJson: string, nodeId: string): boolean {
  try { return JSON.parse(workflowJson)?.[nodeId]?._meta?.optionalReference === 'womens_clothing' }
  catch { return false }
}

/** Only explicitly tagged, fourth-image clothing nodes may be omitted. */
export function prepareOptionalWomensCostume(workflow: Workflow, nodeId: string, hasImage: boolean): Array<{nodeId: string; text: string; hasImage: boolean}> {
  if (workflow[nodeId]?._meta?.optionalReference !== 'womens_clothing') return []
  const consumers = Object.entries(workflow).flatMap(([id, node]) =>
    Object.entries(node.inputs).filter(([, value]) => Array.isArray(value) && String(value[0]) === nodeId).map(([field]) => ({id, node, field}))
  )
  if (!consumers.length || consumers.some(({node, field}) => node.class_type !== 'TextEncodeQwenImage21' || field !== 'images.image_4')) {
    throw new Error('[ComfyUI] 可选女士服装必须连接到 TextEncodeQwenImage21 的第四张参考图')
  }
  if (!hasImage) {
    for (const {node, field} of consumers) delete node.inputs[field]
    delete workflow[nodeId]
  }
  return consumers.map(({id}) => ({
    nodeId: id,
    hasImage,
    text: hasImage
      ? 'Clothing instruction: Image 4 is the ONLY clothing specification for Person A (the woman on the LEFT). Dress Person A in the complete outfit shown in image 4, including its upper and lower garments, hosiery, shoes and accessories. Preserve their design, colors, fabric and patterns. Do not add a shirt, jeans, trousers or sneakers unless image 4 shows them. Do not use clothing from either portrait reference, and do not copy the clothing model identity or pose. Person B (the man on the RIGHT) keeps the navy shirt, dark gray trousers and black shoes described above. Use a non-explicit fashion photograph with no visible nipples or genitals.'
      : 'Clothing instruction: There is NO clothing reference image. Person A (the woman on the LEFT) wears a cream long-sleeved shirt, blue jeans and white sneakers. Person B (the man on the RIGHT) wears a navy shirt, dark gray trousers and black shoes.',
  }))
}

/** Remove the shipped legacy defaults before choosing exactly one clothing instruction. */
export function resolveWomensCostumePrompt(prompt: string, note: {text: string; hasImage: boolean}): string {
  let text = prompt
    .replace(/^Clothing instruction:.*$/gm, '')
    .replace(/Clothing reference is optional and applies only to Person A on the LEFT\. If image 4 is supplied, use it for Person A's outfit only, instead of Person A's default outfit\. If no image 4 is supplied, use the default outfit below\./g, '')
    .replace(/There are NO clothing reference images\./g, '')
    .replace(/Dress Person A in a plain cream long-sleeved shirt, blue jeans and white low-top sneakers\./g, '')
  if (note.hasImage) text = text.replace(/exactly two fully clothed adults/g, 'exactly two adults wearing the specified outfits')
  return `${text.trim()}\n${note.text}`
}
