import test from 'ava';
import mock_require from 'mock-require';

test("cargo_web_command() favors CARGO_WEB environment variable if set", async t => {
    process.env.CARGO_WEB = "/some/other/cargo-web";
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.exec_command = async () => "cargo-web 0.1.2";
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.command, "/some/other/cargo-web");
});

test("cargo_web_command() defaults to 'cargo-web' if CARGO WEB isn't set", async t => {
    process.env.CARGO_WEB = "";
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.command, "cargo-web");
});

test("cargo_web_command returns {isFromEnv: true, isInstalled: false} when custom cargo-web command doesn't exist", async t => {
    process.env.CARGO_WEB = "not-cargo-web";
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.command_exists = async () => false;
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isFromEnv, true);
    t.is(cargo_web.isInstalled, false);
});

test("cargo_web_command returns {isFromEnv: true, isInstalled: false} when custom cargo-web command isn't cargo-web", async t => {
    process.env.CARGO_WEB = "not-cargo-web";
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.command_exists = async () => true;
    CargoWebAsset.exec_command = async () => "not-cargo-web";
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isFromEnv, true);
    t.is(cargo_web.isInstalled, false);
});

test("cargo_web_command returns {isInstalled: true, versionCompare: non-zero} when cargo-web doesn't satisfy required version", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.command_exists = async () => true;
    CargoWebAsset.exec_command = async () => "cargo-web version.is.mocked";
    CargoWebAsset.cargo_web_version_compare = () => -1;

    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isInstalled, true);
    t.is(cargo_web.versionCompare, -1);
});

test("cargo_web_command returns {isInstalled: true, versionCompare: 0} when cargo-web command is valid", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.command_exists = async () => true;
    CargoWebAsset.exec_command = async () => "cargo-web version.is.mocked";
    CargoWebAsset.cargo_web_version_compare = () => 0;

    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isInstalled, true);
    t.is(cargo_web.versionCompare, 0);
});

test("cargo_web_version_compare returns 0 with exact match", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_compare("cargo-web 0.6.3", [0, 6, 3]);
    t.is(result, 0);
});

test("cargo_web_version_compare returns 0 and ignores patch when minor > required minor", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_compare("cargo-web 0.7.2", [0, 6, 3]);
    t.is(result, 0);
});

test("cargo_web_version_compare returns -1 when patch is less", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_compare("cargo-web 0.6.2", [0, 6, 3]);
    t.is(result, -1);
});

test("cargo_web_version_compare returns -1 when minor version is less", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_compare("cargo-web 0.5.3", [0, 6, 3]);
    t.is(result, -1);
});

test("cargo_web_version_compare returns -1 when major version is less", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_compare("cargo-web 0.6.3", [1, 6, 3]);
    t.is(result, -1);
});

test("cargo_web_version_compare returns 1 when major version is greater", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_compare("cargo-web 2.6.3", [1, 6, 3]);
    t.is(result, 1);
});
