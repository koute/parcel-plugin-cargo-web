const fs = require( "fs" );
const path = require( "path" );

async function init( bundler ) {
    const scratch_dir = path.join( bundler.options.cacheDir, ".cargo-web" );
    try { fs.mkdirSync( bundler.options.cacheDir ); } catch( e ) {}
    try { fs.mkdirSync( scratch_dir ); } catch( e ) {}

    bundler.options.paths = [ scratch_dir ];

    bundler.addAssetType( "toml", require.resolve( "./CargoWebAsset.js" ) );

    // This is *technically* a hack, but it works.
    //
    // In Parcel the bundle loaders are supposed to be static,
    // however since we must instantiate the WebAssembly
    // module ourselves we can't really use a single,
    // static loader.
    //
    // So what we do is we generate a unique bundle loader
    // for each Rust asset we compile, and inside that bundle
    // we `require` the real loader. And since the real loader
    // is emitted as a normal dependency it doesn't have to be static.
    let loaders = bundler.bundleLoaders;
    var handler = {
        get: function( target, name ) {
            if( typeof name === "string" ) {
                const matches = name.match( /cargo-web-(.+)/ );
                if( matches ) {
                    const hash = matches[1];
                    const bundle_loader_path = path.join( scratch_dir, `bundle-loader-${hash}.js` );
                    if( !fs.existsSync( bundle_loader_path ) ) {
                        const bundle_loader = `
                            module.exports = function( bundle ) {
                                console.log( bundle );
                                var loader = require( "./loader-${hash}.js" );
                                return loader( bundle );
                            };
                        `;
                        fs.writeFileSync( bundle_loader_path, bundle_loader );
                    }

                    loaders[ name ] = bundle_loader_path;
                    return bundle_loader_path;
                }
            }

            return target[ name ];
        }
    };

    bundler.bundleLoaders = new Proxy( bundler.bundleLoaders, handler );
}

module.exports = init;
