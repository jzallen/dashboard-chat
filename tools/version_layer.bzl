"""Bazel macro: stamped version.json image layer.

Each bazel-built oci_image gets a small tar layer mounting a JSON file at
/etc/dashboard-chat/version.json with the build's git SHA, dirty flag, and
build timestamp. The values come from STABLE_* keys emitted by
tools/workspace_status.sh and are substituted into the JSON via
aspect_bazel_lib's expand_template.stamp_substitutions.

Using STABLE_* (not BUILD_*) stamp keys keeps the Bazel cache warm: only this
small layer rebuilds when the values change; dependent actions stay cached.

Use:
    load("//tools:version_layer.bzl", "version_layer")
    version_layer(name = "version_layer", image_tag = "dashboard-chat/api:bazel")

Then add `":version_layer"` to the `oci_image.tars` list.
"""

load("@aspect_bazel_lib//lib:expand_template.bzl", "expand_template")

def version_layer(name, image_tag):
    """Stamped identity layer for an oci_image.

    Args:
        name: Target name. Produces `{name}` (the tar layer to feed oci_image.tars)
            and `{name}_json` (the templated version.json) as a side-effect target.
        image_tag: The repo:tag string to embed as the "image" field of version.json.
    """
    expand_template(
        name = name + "_json",
        out = name + "_version.json",
        template = "//tools:version.json.tmpl",
        substitutions = {"{IMAGE}": image_tag},
        stamp_substitutions = {
            "{SHA}": "{{STABLE_GIT_COMMIT}}",
            "{DIRTY}": "{{STABLE_GIT_DIRTY}}",
            "{BUILT}": "{{STABLE_BUILD_TIMESTAMP}}",
        },
    )

    native.genrule(
        name = name,
        srcs = [":" + name + "_json"],
        outs = [name + ".tar"],
        cmd = """
            staging=$$(mktemp -d) && \
            mkdir -p $$staging/etc/dashboard-chat && \
            cp $(location :{json}) $$staging/etc/dashboard-chat/version.json && \
            tar -cf $(OUTS) -C $$staging etc && \
            rm -rf $$staging
        """.format(json = name + "_json"),
        tags = ["no-sandbox", "manual"],
    )
