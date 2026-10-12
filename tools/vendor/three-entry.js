// vendor/three-bundle.js の元。tools/vendor/build-three.sh で作る（手で直さない）
import * as THREE_NS from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
const THREE = Object.assign({}, THREE_NS, { OrbitControls, GLTFExporter, USDZExporter });
window.THREE = THREE;
