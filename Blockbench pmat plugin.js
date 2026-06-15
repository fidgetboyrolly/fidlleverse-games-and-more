(function() {

    const plugin = {
        id: "rowen_pmat_exporter",
        title: "Polymat (.pmat) Exporter",
        icon: "icon-format",
        author: "Copilot",
        description: "Exports models into Rowen's Polymat (.pmat) triangle format",
        version: "1.0.0",
        min_version: "4.0.0",
        variant: "both"
    };

    Plugin.register(plugin, {

        onload() {

            new Action("export_pmat", {
                name: "Export as .pmat (Polymat)",
                icon: "icon-export",
                category: "file",
                click() {

                    let triangles = [];

                    Project.meshes.forEach(mesh => {

                        mesh.faces.forEach(face => {

                            let verts = face.getSortedVertices();

                            let triList = [];
                            if (verts.length === 3) {
                                triList.push(verts);
                            } else if (verts.length === 4) {
                                triList.push([verts[0], verts[1], verts[2]]);
                                triList.push([verts[0], verts[2], verts[3]]);
                            }

                            triList.forEach(tri => {

                                let triData = tri.map(v => {
                                    return [
                                        Number(v.x),
                                        Number(v.y),
                                        Number(v.z)
                                    ];
                                });

                                let colorInfo = null;

                                if (face.texture) {
                                    colorInfo = "t:" + face.texture.name;
                                } else if (face.color) {
                                    let c = face.color;
                                    colorInfo = [c.h, c.s, c.v];
                                } else {
                                    colorInfo = [0, 0, 1];
                                }

                                triData.push(colorInfo);

                                triangles.push(triData);
                            });

                        });

                    });

                    Blockbench.export({
                        type: "PMAT",
                        extensions: ["pmat"],
                        name: Project.name + ".pmat",
                        content: JSON.stringify(triangles)
                    });

                }
            });

            MenuBar.addAction("export_pmat", "file.export");
        },

        onunload() {
            MenuBar.removeAction("export_pmat");
        }

    });

})();
