const md5 = require( "parcel-bundler/src/utils/md5" );
const config = require( "parcel-bundler/src/utils/config" );
const fs = require( "parcel-bundler/src/utils/fs" );
const pipeSpawn = require( "parcel-bundler/src/utils/pipeSpawn" );

const command_exists = require( "command-exists" );
const child_process = require( "child_process" );
const Asset = require( "parcel-bundler/src/Asset" );
const path = require( "path" );

const promisify = require( "parcel-bundler/src/utils/promisify" );
const exec = promisify( child_process.execFile );

const REQUIRED_CARGO_WEB = [0, 6, 2];

let counter = 0;
let cargo_web_command = null;

class CargoWebAsset extends Asset {
    constructor( name, pkg, options ) {
        // This has to be unique on every build.
        const hash = md5( name + counter );
        counter += 1;

        super( name, pkg, options );
        this.type = hash;
        this.cargo_web_output = null;
    }

    process() {
        if( this.options.isWarmUp ) {
            return;
        }

        return super.process();
    }

    async check_for_rustup() {
        try {
            await command_exists( "rustup" );
        } catch( err ) {
            throw new Error(
                "Rustup isn't installed. Visit https://rustup.rs/ for more info."
            );
        }
    }

    async install_nightly() {
        let [stdout] = await exec( "rustup", ["show"] );
        if( !stdout.includes( "nightly" ) ) {
            await pipeSpawn( "rustup", ["update"] );
            await pipeSpawn( "rustup", ["toolchain", "install", "nightly"] );
        }
    }

    async install_cargo_web() {
        if( cargo_web_command ) {
            return;
        }

        if( process.env.CARGO_WEB ) {
            cargo_web_command = process.env.CARGO_WEB;
            return;
        }

        const version = await new Promise( (resolve) => {
            child_process.execFile( "cargo-web", [ "--version" ], (err, stdout) => {
                if( err ) {
                    resolve( [0, 0, 0] );
                } else {
                    const matches = /(\d+)\.(\d+)\.(\d+)/.exec( stdout );
                    resolve( [parseInt( matches[1], 10 ), parseInt( matches[2], 10 ), parseInt( matches[3], 10 )] );
                }
            })
        });

        let is_up_to_date = true;
        for( let i = 0; i < REQUIRED_CARGO_WEB.length; ++i ) {
            if( version[i] > REQUIRED_CARGO_WEB[i] ) {
                break;
            } else if( version[i] === REQUIRED_CARGO_WEB[i] ) {
                continue;
            } else {
                is_up_to_date = false;
                break;
            }
        }

        if( !is_up_to_date ) {
            await pipeSpawn( "cargo", [ "install", "-f", "cargo-web" ] );
        }

        cargo_web_command = "cargo-web";
    }

    async parse() {
        await this.check_for_rustup();
        await this.install_nightly();
        await this.install_cargo_web();

        const dir = path.dirname( await config.resolve( this.name, ["Cargo.toml"] ) );
        const args = [
            "run",
            "nightly",
            cargo_web_command,
            "build",
            "--target",
            "wasm32-unknown-unknown",
            "--runtime",
            "experimental-only-loader",
            "--message-format",
            "json"
        ];

        const opts = {
            cwd: dir,
            stdio: ["ignore", "pipe", "pipe"]
        };

        let artifact_wasm = null;
        let artifact_js = null;
        let output = "";

        const child = child_process.spawn( "rustup", args, opts );
        let stdout = "";
        let stderr = "";

        child.stdout.on( "data", (data) => {
            stdout += data;
            for( ;; ) {
                const index = stdout.indexOf( "\n" );
                if( index < 0 ) {
                    break;
                }

                const raw_msg = stdout.substr( 0, index );
                stdout = stdout.substr( index + 1 );
                const msg = JSON.parse( raw_msg );

                if( msg.reason === "compiler-artifact" ) {
                    msg.filenames.forEach( filename => {
                        if( filename.match( /\.js$/ ) ) {
                            artifact_js = filename;
                        } else if( filename.match( /\.wasm$/ ) ) {
                            artifact_wasm = filename;
                        }
                    });
                } else if( msg.reason === "message" ) {
                    output += msg.message.rendered;
                } else if( msg.reason === "cargo-web-paths-to-watch" ) {
                    const paths = msg.paths.map( (entry) => entry.path );
                    paths.forEach( (path) => {
                        if( path === this.name ) {
                            return;
                        }

                        this.addDependency( path, { includedInParent: true } );
                    });
                }
            }
        });

        child.stderr.on( "data", (data) => {
            stderr += data;
            for( ;; ) {
                const index = stderr.indexOf( "\n" );
                if( index < 0 ) {
                    break;
                }

                const line = stderr.substr( 0, index );
                stderr = stderr.substr( index + 1 );
                output += line + "\n";
            }
        });

        const status = await new Promise( (resolve) => {
            child.on( "close", (code) => {
                resolve( code );
            });
        });

        if( status !== 0 ) {
            this.cargo_web_output = "Compilation failed!\n" + output;
            throw new Error( `Compilation failed!` );
        }

        if( artifact_js === null ) {
            throw new Error( "No .js artifact found! Are you sure your crate is of proper type?" );
        }

        if( artifact_wasm === null ) {
            throw new Error( "No .wasm artifact found! This should never happen!" );
        }

        // This is *technically* a hack, but it works.
        //
        // In Parcel the loaders are supposed to be static,
        // however since we must instantiate the WebAssembly
        // module ourselves we can't really use a static loader.
        const loader_body = await fs.readFile( artifact_js );
        const loader_path = path.join( path.dirname( artifact_js ), "parcel-loader.js" );
        const loader = `
            module.exports = function( bundle ) {
                ${loader_body}
                return fetch( bundle )
                    .then( response => response.arrayBuffer() )
                    .then( bytes => WebAssembly.compile( bytes ) )
                    .then( mod => __initialize( mod, true ) );
            };
        `;

        await fs.writeFile( loader_path, loader );
        this.options.bundleLoaders[ this.type ] = loader_path;
        this.artifact_wasm = artifact_wasm;
    }

    collectDependencies() {}

    generate() {
        const generated = {};
        generated[ this.type ] = {
            path: this.artifact_wasm,
            mtime: Date.now()
        };

        return generated;
    }

    generateErrorMessage( err ) {
        if( this.cargo_web_output ) {
            err.message = this.cargo_web_output;
            if( err.message.indexOf( "\x1B" ) >= 0 ) {
                // Prevent everything from being red.
                err.message = err.message.replace( /\n/g, "\n\x1B[0;37m" );
            }

            err.stack = "";
        }

        return err;
    }
}

module.exports = CargoWebAsset;
