// Minimal subset of BufferGeometryUtils needed for instancing.
import { BufferGeometry } from "./three.module.js";

export function mergeGeometries(geometries, useGroups = false) {
  if (!Array.isArray(geometries) || geometries.length === 0) return null;
  const isIndexed = geometries[0]?.index !== null;
  const attributesUsed = new Set(Object.keys(geometries[0]?.attributes || {}));
  const merged = new BufferGeometry();
  const offset = { index: 0 };
  const mergedAttributes = {};

  geometries.forEach((geometry, index) => {
    if (!(geometry instanceof BufferGeometry)) {
      throw new Error("mergeGeometries expects instances of BufferGeometry");
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (!attributesUsed.has(name)) {
        attributesUsed.add(name);
      }
    }
    if (useGroups) {
      const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
      merged.addGroup(offset.index, count, index);
      offset.index += count;
    }
  });

  for (const name of attributesUsed) {
    let arrayLength = 0;
    let itemSize = 0;
    geometries.forEach((geometry) => {
      const attr = geometry.attributes[name];
      if (!attr) {
        throw new Error(`Attribute ${name} missing on geometry for merge.`);
      }
      if (!itemSize) itemSize = attr.itemSize;
      arrayLength += attr.count * itemSize;
    });
    const array = new Float32Array(arrayLength);
    let offsetAttr = 0;
    geometries.forEach((geometry) => {
      const attr = geometry.attributes[name];
      array.set(attr.array, offsetAttr);
      offsetAttr += attr.array.length;
    });
    mergedAttributes[name] = { array, itemSize };
  }

  for (const [name, data] of Object.entries(mergedAttributes)) {
    merged.setAttribute(name, new geometries[0].attributes[name].constructor(data.array, data.itemSize));
  }

  if (isIndexed) {
    let totalLength = 0;
    geometries.forEach((geometry) => {
      totalLength += geometry.index.count;
    });
    const mergedIndex = new Uint32Array(totalLength);
    let indexOffset = 0;
    let vertexOffset = 0;
    geometries.forEach((geometry) => {
      const index = geometry.index;
      mergedIndex.set(index.array, indexOffset);
      for (let i = indexOffset; i < indexOffset + index.count; i += 1) {
        mergedIndex[i] += vertexOffset;
      }
      indexOffset += index.count;
      vertexOffset += geometry.attributes.position.count;
    });
    merged.setIndex(mergedIndex);
  }

  return merged;
}
