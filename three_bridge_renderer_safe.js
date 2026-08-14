(function() {
    const pluginId = 'three_bridge_renderer_safe';
    const pluginName = 'Three.js Safe Bridge & Preview';

    let threePreviewDialog = null;
    let renderer, scene, camera, controls;
    let textureCache = {};

    Plugin.register(pluginId, {
        title: pluginName,
        icon: 'icon-preview',
        author: 'fidgetboyrolly',
        description: 'Three.js preview + export bridge with full default fallbacks.',
        version: '0.2.0',
        variant: 'both',

        onload() {
            threePreviewDialog = new Dialog({
                id: 'three_preview_window',
                title: 'Three.js Preview',
                width: 500,
                height: 500,
                lines: [
                    '<canvas id="three_preview_canvas" style="width:100%;height:100%;"></canvas>'
                ]
            });

            new Action('open_three_preview', {
                name: 'Open Three.js Preview',
                icon: 'icon-preview',
                category: 'view',
                click() {
                    threePreviewDialog.show();
                    initThreePreview();
                    rebuildThreeScene();
                    animate();
                }
            });

            new Action('export_three_json', {
                name: 'Export Three.js JSON',
                icon: 'icon-save',
                category: 'file',
                click() {
                    const data = buildThreeSceneData();
                    Blockbench.export({
                        type: 'JSON',
                        extensions: ['json'],
                        name: Project.name || 'three_scene',
                        content: JSON.stringify(data, null, 2)
                    });
                }
            });

            Project.on('change', () => {
                if (scene) rebuildThreeScene();
            });
        },

        onunload() {
            if (threePreviewDialog) threePreviewDialog.close();
        }
    });

    // ------------------ SAFE DEFAULTS ------------------

    function safeVec3(v, fallback=[0,0,0]) {
        if (!v || !Array.isArray(v)) return fallback.slice();
        return [
            v[0] ?? fallback[0],
            v[1] ?? fallback[1],
            v[2] ?? fallback[2]
        ];
    }

    function safeNumber(n, fallback=0) {
        return (typeof n === 'number') ? n : fallback;
    }

    function safeFace(face) {
        return {
            texture: face?.texture ?? null,
            uv: face?.uv ?? [0,0,16,16]
        };
    }

    // ------------------ THREE.JS SETUP ------------------

    function initThreePreview() {
        const canvas = document.getElementById('three_preview_canvas');
        if (!canvas) return;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x202020);

        camera = new THREE.PerspectiveCamera(
            60,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            1000
        );
        camera.position.set(10, 10, 10);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, 20, 10);
        scene.add(light);

        if (THREE.OrbitControls) {
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
        }
    }

    // ------------------ BUILD SCENE ------------------

    function rebuildThreeScene() {
        if (!scene) return;

        scene.children = scene.children.filter(c => !(c.isMesh || c.isGroup));

        const root = new THREE.Group();
        root.name = Project.name || 'Model';

        // Groups
        Group.all.forEach(g => {
            root.add(buildGroup(g));
        });

        // Orphan cubes
        elements.forEach(el => {
            if (!el.parent || el.parent === 'root') {
                root.add(buildCube(el));
            }
        });

        scene.add(root);
        renderer.render(scene, camera);
    }

    function buildGroup(bbGroup) {
        const group = new THREE.Group();
        group.name = bbGroup.name || 'Group';

        const origin = safeVec3(bbGroup.origin);
        const rotation = safeVec3(bbGroup.rotation);

        group.position.set(origin[0], origin[1], origin[2]);
        group.rotation.set(
            THREE.MathUtils.degToRad(rotation[0]),
            THREE.MathUtils.degToRad(rotation[1]),
            THREE.MathUtils.degToRad(rotation[2])
        );

        bbGroup.children.forEach(child => {
            if (child instanceof Cube) group.add(buildCube(child));
            if (child instanceof Group) group.add(buildGroup(child));
        });

        return group;
    }

    function buildCube(el) {
        const from = safeVec3(el.from);
        const to = safeVec3(el.to, [from[0]+1, from[1]+1, from[2]+1]);

        const size = [
            to[0] - from[0],
            to[1] - from[1],
            to[2] - from[2]
        ];

        const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);

        const faces = ['north','south','east','west','up','down'];
        const materials = faces.map(face => {
            const f = safeFace(el.faces?.[face]);
            if (f.texture) {
                const tex = getTexture(f.texture);
                return new THREE.MeshStandardMaterial({ map: tex });
            }
            return new THREE.MeshStandardMaterial({ color: 0xffffff });
        });

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.position.set(
            from[0] + size[0]/2,
            from[1] + size[1]/2,
            from[2] + size[2]/2
        );

        return mesh;
    }

    function getTexture(uuid) {
        if (textureCache[uuid]) return textureCache[uuid];

        const texObj = Texture.all.find(t => t.uuid === uuid);
        if (!texObj || !texObj.img) {
            const fallback = new THREE.Texture();
            fallback.needsUpdate = true;
            textureCache[uuid] = fallback;
            return fallback;
        }

        const tex = new THREE.Texture(texObj.img);
        tex.needsUpdate = true;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestMipMapNearestFilter;

        textureCache[uuid] = tex;
        return tex;
    }

    // ------------------ EXPORT ------------------

    function buildThreeSceneData() {
        const root = {
            type: 'Scene',
            name: Project.name || 'Model',
            children: []
        };

        Group.all.forEach(g => root.children.push(exportGroup(g)));
        elements.forEach(el => {
            if (!el.parent || el.parent === 'root') {
                root.children.push(exportCube(el));
            }
        });

        return root;
    }

    function exportGroup(g) {
        return {
            type: 'Group',
            name: g.name || 'Group',
            origin: safeVec3(g.origin),
            rotation: safeVec3(g.rotation),
            children: g.children.map(child =>
                child instanceof Cube ? exportCube(child) : exportGroup(child)
            )
        };
    }

    function exportCube(el) {
        const from = safeVec3(el.from);
        const to = safeVec3(el.to, [from[0]+1, from[1]+1, from[2]+1]);

        return {
            type: 'Cube',
            name: el.name || 'Cube',
            from,
            to,
            faces: Object.fromEntries(
                ['north','south','east','west','up','down'].map(face => [
                    face,
                    safeFace(el.faces?.[face])
                ])
            )
        };
    }

    // ------------------ LOOP ------------------

    function animate() {
        requestAnimationFrame(animate);
        if (controls) controls.update();
        renderer.render(scene, camera);
    }
})();
