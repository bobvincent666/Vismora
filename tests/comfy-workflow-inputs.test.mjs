import assert from 'node:assert/strict'
import test from 'node:test'
import { missingComfyRequiredInputs } from '../src/services/comfyWorkflowInputs.ts'

const group = (min, extra = {}) => ['COMFY_AUTOGROW_V3', {
  template: { input: { required: { image: ['IMAGE', {}] } }, names: ['image_1', 'image_2', 'image_3'], min, ...extra },
}]

test('Qwen three-image API inputs do not require an images container', () => {
  assert.deepEqual(missingComfyRequiredInputs({ clip: ['CLIP'], images: group(0) }, {
    clip: ['2', 0], 'images.image_1': ['12', 0], 'images.image_2': ['13', 0], 'images.image_3': ['11', 0],
  }), [])
})

test('zero-minimum group can be omitted, while ordinary required inputs remain checked', () => {
  assert.deepEqual(missingComfyRequiredInputs({ clip: ['CLIP'], images: group(0) }, {}), ['clip'])
})

test('required dynamic children follow template names, not just the number of inputs', () => {
  assert.deepEqual(missingComfyRequiredInputs({ images: group(2) }, { 'images.image_2': ['13', 0] }), ['images.image_1'])
})

test('prefix templates serialize zero-based child names', () => {
  const spec = ['COMFY_AUTOGROW_V3', { template: {
    prefix: 'ref_', min: 2, max: 3, input: { required: { image: ['IMAGE'] } },
  } }]
  assert.deepEqual(missingComfyRequiredInputs({ refs: spec }, { 'refs.ref_0': ['1', 0] }), ['refs.ref_1'])
})

test('optional template children do not become required through min', () => {
  const spec = group(2, { input: { optional: { image: ['IMAGE'] } } })
  assert.deepEqual(missingComfyRequiredInputs({ images: spec }, {}), [])
})

test('unknown or malformed dynamic schemas keep the ordinary required check', () => {
  assert.deepEqual(missingComfyRequiredInputs({ images: ['COMFY_AUTOGROW_V3', {}], model: ['MODEL'] }, {}), ['images', 'model'])
})
