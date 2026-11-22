/**
 * Fetches the files a region is made from and keeps what was read in a
 * cache folder, so a second run touches no network. Rasters are
 * cloud-optimised GeoTIFFs: only the overview asked for is downloaded, a few
 * megabytes of a file that may weigh a hundred.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fromUrl } from 'geotiff';

const SAMPLE_ARRAYS = { Uint8Array, Int16Array, Uint16Array, Float32Array };

/**
 * One overview of the GeoTIFF at `url`: the one `overviewWidth` pixels wide,
 * as `{ width, height, samples }` with the samples row by row from the
 * north-west corner. Undefined when the server has no such file (it answers
 * 404), which is how these datasets say "nothing but sea here". Throws for
 * any other refusal and when the file has no overview of that width.
 */
export async function readRasterOverview({ url, overviewWidth, cacheDirectory }) {
  const cacheFile = path.join(cacheDirectory, `${path.basename(new URL(url).pathname)}.${overviewWidth}`);
  if (existsSync(`${cacheFile}.json`)) {
    const header = JSON.parse(readFileSync(`${cacheFile}.json`, 'utf8'));
    if (header.missing) return undefined;
    const bytes = readFileSync(`${cacheFile}.bin`);
    const SampleArray = SAMPLE_ARRAYS[header.type];
    if (!SampleArray || bytes.byteLength !== header.width * header.height * SampleArray.BYTES_PER_ELEMENT) throw new Error(`${cacheFile}.bin is not what its header says: delete it and run again`);
    return { width: header.width, height: header.height, samples: new SampleArray(bytes.buffer, bytes.byteOffset, bytes.byteLength / SampleArray.BYTES_PER_ELEMENT) };
  }
  mkdirSync(cacheDirectory, { recursive: true });
  const response = await fetch(url, { method: 'HEAD' });
  if (response.status === 404) {
    writeFileSync(`${cacheFile}.json`, JSON.stringify({ missing: true }));
    return undefined;
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const tiff = await fromUrl(url);
  const imageCount = await tiff.getImageCount();
  for (let index = 0; index < imageCount; index += 1) {
    const image = await tiff.getImage(index);
    if (image.getWidth() !== overviewWidth) continue;
    const [samples] = await image.readRasters();
    const type = samples.constructor.name;
    if (!SAMPLE_ARRAYS[type]) throw new Error(`${url} holds ${type} samples, which this script does not read`);
    // The header is written last: a run that stops half way leaves nothing a later run would take for a whole file.
    writeFileSync(`${cacheFile}.bin`, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    writeFileSync(`${cacheFile}.json`, JSON.stringify({ width: image.getWidth(), height: image.getHeight(), type }));
    return { width: image.getWidth(), height: image.getHeight(), samples };
  }
  throw new Error(`${url} has no overview ${overviewWidth} pixels wide`);
}

/** The JSON document at `url`. */
export async function readJsonFile({ url, cacheDirectory }) {
  const cacheFile = path.join(cacheDirectory, path.basename(new URL(url).pathname));
  if (!existsSync(cacheFile)) {
    mkdirSync(cacheDirectory, { recursive: true });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    writeFileSync(`${cacheFile}.part`, Buffer.from(await response.arrayBuffer()));
    renameSync(`${cacheFile}.part`, cacheFile);
  }
  return JSON.parse(readFileSync(cacheFile, 'utf8'));
}
