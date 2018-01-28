async function init( bundler ) {
    bundler.addAssetType( "toml", require.resolve( "./CargoWebAsset.js" ) );
}

module.exports = init;
