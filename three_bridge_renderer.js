(function() {
    const pluginId = 'three_bridge_renderer';
    const pluginName = 'Three.js Bridge & Preview';

    let threePreviewDialog = null;
    let renderer, scene, camera, controls;
    let textureCache = {};

    Plugin.register(pluginId, {
        title: pluginName,
        icon: 'icon-preview',
        author: 'fidgetboyrolly',
        description: 'Live Three.js preview + export bridge for Blockbench models.',
        version: '0.1.0',
        variant: 'both',

        onload() {
            // Dialog with canvas
            threePreviewDialog = new Dialog({
                id: 'three_preview_window',
                title: 'Three.js Preview',
                width: 500,
                height: 500,
                lines: [
                    '<div style="width:100%;height:100%;overflow:hidden;">' +
                    '<canvas id="three_preview_canvas" style="width:100%;height:100%;"></canvas>' +
                    '</div>'
                ],
                onConfirm() {},
                onCancel() {}
            });

            // Action: open preview
            new Action('open_three_preview', {
                name: 'Open Three.js Preview',
                description: 'Open a Three.js renderer for the current model',
                icon: 'icon-preview',
                category: 'view',
                click() {
                    threePreviewDialog.show();
                    initThreePreview();
                    rebuildThreeScene();
                    animate();
                }
            });

            // Action: export to Three.js JSON
            new Action('export_three_json', {
                name: 'Export Three.js JSON',
                description: 'Export current Blockbench model as a Three.js scene JSON',
                icon: 'icon-save',
                category: 'file',
                click() {
                    const sceneData = buildThreeSceneData();
                    Blockbench.export({
                        type: 'JSON',
                        extensions: ['json'],
                        name: Project.name || 'three_scene',
                        content: JSON.stringify(sceneData, null, 2)
                    });
                }
            });

            // Live update on project changes
            Project.on('change', function() {
                if (scene) rebuildThreeScene();
            });
        },

        onunload() {
            if (threePreviewDialog) threePreviewDialog.close();
            renderer = null;
            scene = null;
            camera = null;
            controls = null;
            textureCache = {};
        }
    });

    // ---------- Three.js setup ----------

    function initThreePreview() {
        const canvas = document.getElementById('three_preview_canvas');
        if (!canvas) return;

        // Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x202020);

        // Camera
        const aspect = canvas.clientWidth / canvas.clientHeight;
        camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        camera.position.set(10, 10, 10);
        camera.lookAt(0, 0, 0);

        // Renderer
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        // Lights
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemi.position.set(0, 20, 0);
        scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(10, 20, 10);
        scene.add(dir);

        // OrbitControls (if available)
        if (THREE.OrbitControls) {
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.1;
        }
    }

    // ---------- Build scene from Blockbench ----------

    function rebuildThreeScene() {
        if (!scene || !renderer || !camera) return;

        // Clear everything except lights
        scene.children = scene.children.filter(c => !(c.isMesh || c.isGroup));

        textureCache = {};

        const rootGroup = new THREE.Group();
        rootGroup.name = Project.name || 'BlockbenchModel';

        // Build hierarchy from groups and cubes
        Group.all.forEach(group => {
            const g = buildThreeGroupFromGroup(group);
            if (g) rootGroup.add(g);
        });

        // Orphan elements (not in groups)
        elements.forEach(el => {
            if (!el.parent || el.parent === 'root') {
                const mesh = buildThreeMeshFromElement(el);
                if (mesh) rootGroup.add(mesh);
            }
        });

        // Center model
        rootGroup.position.set(0, 0, 0);
        scene.add(rootGroup);

        renderer.render(scene, camera);
    }

    function buildThreeGroupFromGroup(bbGroup) {
        const group = new THREE.Group();
        group.name = bbGroup.name || 'Group';

        // Position/rotation from origin
        if (bbGroup.origin) {
            group.position.set(bbGroup.origin[0], bbGroup.origin[1], bbGroup.origin[2]);
        }
        if (bbGroup.rotation) {
            group.rotation.set(
                THREE.MathUtils.degToRad(bbGroup.rotation[0] || 0),
                THREE.MathUtils.degToRad(bbGroup.rotation[1] || 0),
                THREE.MathUtils.degToRad(bbGroup.rotation[2] || 0)
            );
        }

        // Children cubes
        bbGroup.children.forEach(child => {
            if (child instanceof Cube) {
                const mesh = buildThreeMeshFromElement(child);
                if (mesh) group.add(mesh);
            } else if (child instanceof Group) {
                const sub = buildThreeGroupFromGroup(child);
                if (sub) group.add(sub);
            }
        });

        return group;
    }

    function buildThreeMeshFromElement(el) {
        const from = el.from;
        const to = el.to;

        const size = [
            to[0] - from[0],
            to[1] - from[1],
            to[2] - from[2]
        ];

        const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);

        // Build materials per face
        const materials = [];
        const faceOrder = ['north', 'south', 'east', 'west', 'up', 'down'];

        faceOrder.forEach(faceName => {
            const face = el.faces[faceName];
            let mat;

            if (face && face.texture) {
                const tex = getThreeTextureFromBBTexture(face.texture);
                mat = new THREE.MeshStandardMaterial({
                    map: tex,
                    roughness: 0.8,
                    metalness: 0.0
                });
            } else {
                mat = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.8,
                    metalness: 0.0
                });
            }

            materials.push(mat);
        });

        const mesh = new THREE.Mesh(geometry, materials);

        // Position: center of cube
        mesh.position.set(
            from[0] + size[0] / 2,
            from[1] + size[1] / 2,
            from[2] + size[2] / 2
        );

        mesh.name = el.name || 'Cube';

        return mesh;
    }

    function getThreeTextureFromBBTexture(bbTex) {
        // bbTex is a Texture object or its UUID
        let texObj = bbTex;
        if (typeof bbTex === 'string') {
            texObj = Texture.all.find(t => t.uuid === bbTex);
        }
        if (!texObj) return null;

        if (textureCache[texObj.uuid]) {
            return textureCache[texObj.uuid];
        }

        const image = texObj.img || texObj.canvas;
        if (!image) return null;

        const threeTex = new THREE.Texture(image);
        threeTex.needsUpdate = true;
        threeTex.magFilter = THREE.NearestFilter;
        threeTex.minFilter = THREE.NearestMipMapNearestFilter;

        textureCache[texObj.uuid] = threeTex;
        return threeTex;
    }

    // ---------- Export bridge (JSON scene) ----------

    function buildThreeSceneData() {
        const root = {
            type: 'Scene',
            name: Project.name || 'BlockbenchModel',
            children: []
        };

        Group.all.forEach(group => {
            root.children.push(exportGroup(group));
        });

        elements.forEach(el => {
            if (!el.parent || el.parent === 'root') {
                root.children.push(exportElement(el));
            }
        });

        return root;
    }

    function exportGroup(bbGroup) {
        const node = {
            type: 'Group',
            name: bbGroup.name || 'Group',
            position: bbGroup.origin ? bbGroup.origin.slice() : [0, 0, 0],
            rotation: bbGroup.rotation ? bbGroup.rotation.slice() : [0, 0, 0],
            children: []
        };

        bbGroup.children.forEach(child => {
            if (child instanceof Cube) {
                node.children.push(exportElement(child));
            } else if (child instanceof Group) {
                node.children.push(exportGroup(child));
            }
        });

        return node;
    }

    function exportElement(el) {
        const from = el.from;
        const to = el.to;

        const size = [
            to[0] - from[0],
            to[1] - from[1],
            to[2] - from[2]
        ];

        const node = {
            type: 'Mesh',
            name: el.name || 'Cube',
            geometry: {
                type: 'BoxGeometry',
                size: size
            },
            position: [
                from[0] + size[0] / 2,
                from[1] + size[1] / 2,
                from[2] + size[2] / 2
            ],
            materials: [],
            faces: {}
        };

        const faceOrder = ['north', 'south', 'east', 'west', 'up', 'down'];
        faceOrder.forEach(faceName => {
            const face = el.faces[faceName];
            if (face && face.texture) {
                node.faces[faceName] = {
                    texture_uuid: face.texture,
                    uv: face.uv ? face.uv.slice() : null
                };
            } else {
                node.faces[faceName] = null;
            }
        });

        return node;
    }

    // ---------- Animation loop ----------

    function animate() {
        if (!renderer || !scene || !camera) return;

        requestAnimationFrame(animate);

        if (controls) controls.update();
        renderer.render(scene, camera);
    }
})();
