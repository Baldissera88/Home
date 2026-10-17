import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const s = b.max.map((m, i) => (m - b.min[i]).toFixed(2));
  console.log(f.split('/').pop(), 'size', s.join(' x '), 'min', b.min.map(v => v.toFixed(2)).join(','));
}
