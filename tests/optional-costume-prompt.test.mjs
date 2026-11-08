import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareOptionalWomensCostume, resolveWomensCostumePrompt } from '../src/services/optionalCostume.ts'

const fixture = () => ({
  '4': {class_type:'TextEncodeQwenImage21',inputs:{'images.image_4':['15',0]}},
  '15': {class_type:'LoadImage',inputs:{image:''},_meta:{optionalReference:'womens_clothing'}},
})
const legacy = "Create exactly two fully clothed adults. Dress Person A in a plain cream long-sleeved shirt, blue jeans and white low-top sneakers. Dress Person B in a navy shirt.\nClothing instruction: old default.";

test('selected clothing removes the shipped conflicting default, even from stored old workflows', () => {
  const [note] = prepareOptionalWomensCostume(fixture(), '15', true)
  const prompt = resolveWomensCostumePrompt(legacy, note)
  assert.doesNotMatch(prompt, /cream|blue jeans|white low-top sneakers|fully clothed|old default/)
  assert.match(prompt, /ONLY clothing specification/)
  assert.match(prompt, /Person B in a navy shirt/)
  assert.equal(resolveWomensCostumePrompt(prompt, note), prompt)
})

test('unselected clothing sends only the default outfit instruction', () => {
  const [note] = prepareOptionalWomensCostume(fixture(), '15', false)
  const prompt = resolveWomensCostumePrompt(legacy, note)
  assert.match(prompt, /cream long-sleeved shirt/)
  assert.doesNotMatch(prompt, /Image 4|old default/)
  assert.equal((prompt.match(/Clothing instruction:/g)||[]).length, 1)
})
