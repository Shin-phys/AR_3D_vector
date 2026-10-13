// vendor/three-bundle.js の元。tools/vendor/build-three.sh で作る（手で直さない）
import * as THREE_NS from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
// USDZ に動き（timeSamples）を書き足すため、zip の読み書きも出しておく（ar.js）
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
const THREE = Object.assign({}, THREE_NS, { OrbitControls, GLTFExporter, USDZExporter,
  fflate: { zipSync, unzipSync, strToU8, strFromU8 } });
window.THREE = THREE;
