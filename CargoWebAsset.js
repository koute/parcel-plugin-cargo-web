const md5 = require( "parcel-bundler/src/utils/md5" );
const config = require( "parcel-bundler/src/utils/config" );
const fs = require( "parcel-bundler/src/utils/fs" );
const pipeSpawn = require( "parcel-bundler/src/utils/pipeSpawn" );

const Asset = require( "parcel-bundler/src/Asset" );
const path = require( "path" );

const REQUIRED_CARGO_WEB = [0, 6, 2];

class CargoWebAsset extends Asset {
    constructor( name, pkg, options ) {
        super( name, pkg, options );

        this.type = "cargo-web-" + md5( name );

        this.cargo_web_output = null;
        this.scratch_dir = path.join( options.cacheDir, ".cargo-web" );
    }

    static async command_exists(cmd) {
        const command_exists = require( "command-exists" );

        // Simplify the API by resolving to true/false. This behavior is easier to mock.
        try {
            await command_exists(cmd);
            return true;
        } catch(_) {
            return false;
        }
    }

    static async exec_command(cmd, args) {
        const {execFile} = require( "child-process-promise" );

        // Simplify the API by resolving to the std output.
        const result = await execFile(cmd, args);
        return result.stdout;
    }

    static async exec(cmd, args) {
        const {exec} = require( "child-process-promise" );
        const result = await exec(cmd, args);
        return result.stdout;
    }

    static async cargo_web_command() {
        let command = "cargo-web",
            isFromEnv = false,
            isInstalled,
            versionCompare;

        if (process.env.CARGO_WEB) {
            command = process.env.CARGO_WEB;
            isFromEnv = true;
        }

        if(!await CargoWebAsset.command_exists(command)) {
            isInstalled = false;
        } else {
            const cargo_web_output = await CargoWebAsset.exec_command( command, [ "--version" ]);

            // Make sure the command is actually cargo-web
            if (cargo_web_output.startsWith("cargo-web ")) {
                isInstalled = true;
                versionCompare = CargoWebAsset.cargo_web_version_compare(cargo_web_output, REQUIRED_CARGO_WEB);
            } else {
                isInstalled = false;
            }
        }

        return { command: command, isFromEnv: isFromEnv, isInstalled: isInstalled, versionCompare: versionCompare };
    }

    /**
     * Compares the actual version of cargo-web to the required version. The version comparision assumes semantic
     * versioning:
     *
     * - Major version must be an exact match
     * - If the actual minor version is greater than the required minor version, patch doesn't matter
     *
     * @param cargo_version_output
     * The output from `cargo-web --version`
     *
     * @param required_version
     * An array of numbers in the form [major, minor, patch]
     *
     * @returns
     * - 0 if the version is satisfied
     * - 1 if the version is greater than the required version
     * - -1 if the version is less than the required version
     */
    static cargo_web_version_compare(cargo_version_output, required_version) {
        const [major, minor, patch] = /(\d+)\.(\d+)\.(\d+)/
            .exec( cargo_version_output )
            .slice(1)
            .map(match => parseInt(match, 10));

        const [required_major, required_minor, required_patch] = required_version;

        if (major < required_major){
            return -1;
        } else if (major > required_major) {
            return 1;
        }

        return minor > required_minor || (minor === required_minor && patch >= required_patch) ? 0 : -1;
    }

    static install_cargo_web() {
        return pipeSpawn("cargo", ["install", "-f", "cargo-web"]);
    }

    async rust_build(cargo_web_command) {
        const {spawn} = require( "child-process-promise" );

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

        const rust_build = spawn( "rustup", args, opts );
        const rust_build_process = rust_build.childProcess;

        let artifact_wasm = null;
        let artifact_js = null;
        let output = "";
        let stdout = "";
        let stderr = "";

        rust_build_process.stdout.on( "data", data => {
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
                    artifact_js = msg.filenames.find(filename => filename.match( /\.js$/ ));
                    artifact_wasm = msg.filenames.find(filename => filename.match( /\.wasm$/ ));
                } else if( msg.reason === "message" ) {
                    output += msg.message.rendered;
                } else if( msg.reason === "cargo-web-paths-to-watch" ) {
                    msg.paths
                        .filter( entry => entry.path !== this.name )
                        .forEach( entry => this.addDependency( entry.path, { includedInParent: true } ) );
                }
            }
        });

        rust_build_process.stderr.on( "data", (data) => {
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

        try {
            await rust_build;
            return {artifactJs: artifact_js, artifactWasm: artifact_wasm, output: output, succeeded: true};
        } catch(_) {
            return {artifactJs: artifact_js, artifactWasm: artifact_wasm, output: output, succeeded: false};
        }
    }

    process() {
        if( this.options.isWarmUp ) {
            return;
        }

        return super.process();
    }

    static async install_nightly() {
        const rustup_show_output = await CargoWebAsset.exec( "rustup show" );
        if( !rustup_show_output.includes( "nightly" ) ) {
            await pipeSpawn( "rustup", ["update"] );
            await pipeSpawn( "rustup", ["toolchain", "install", "nightly"] );
        }
    }

    async parse() {
        if ( !await CargoWebAsset.command_exists("rustup") ) {
            throw new Error("Rustup isn't installed. Visit https://rustup.rs/ for more info.");
        }

        await CargoWebAsset.install_nightly();

        const cargo_web = await CargoWebAsset.cargo_web_command();
        const required_version = "^" + REQUIRED_CARGO_WEB.join(".");

        if(cargo_web.isFromEnv) {
            if (!cargo_web.isInstalled) {
                throw new Error("The cargo-web location defined in CARGO_WEB isn't valid.")
            } else if (cargo_web.versionCompare === -1) {
                throw new Error(`The cargo-web executable defined in CARGO_WEB needs to be manually upgraded to satisfy the version constraint ${required_version}`);
            } else if (cargo_web.versionCompare === 1) {
                throw new Error(`The cargo-web executable defined in CARGO_WEB needs to be manually downgraded to satisfy the version constraint ${required_version}`);
            }
        } else {
            if (cargo_web.isInstalled) {
                if (cargo_web.versionCompare === -1) {
                    await CargoWebAsset.install_cargo_web();
                } else if(cargo_web.versionCompare === 1){
                    throw new Error(`The installed version of cargo-web will need to be downgraded to satisfy the version constraint ${required_version}`)
                }
            } else {
                await CargoWebAsset.install_cargo_web();
            }
        }

        const rust_build = await this.rust_build(cargo_web.command);

        if(!rust_build.succeeded) {
            this.cargo_web_output = `Compilation failed!\n${rust_build.output}`;
            throw new Error( this.cargo_web_output );
        }

        if(!rust_build.artifactJs) {
            throw new Error( "No .js artifact found! Are you sure your crate is of proper type?" );
        }

        if(!rust_build.artifactWasm) {
            throw new Error( "No .wasm artifact found! This should never happen!" );
        }

        const loader_body = await fs.readFile( rust_build.artifactJs );
        const loader_path = path.join( this.scratch_dir, "loader-" + md5( this.name ) + ".js" );
        const loader = `
            module.exports = function( bundle ) {
                ${loader_body}
                return fetch( bundle )
                    .then( response => response.arrayBuffer() )
                    .then( bytes => WebAssembly.compile( bytes ) )
                    .then( mod => __initialize( mod, true ) );
            };
        `;

        // HACK: If we don't do this we're going to get
        // "loadedAssets is not iterable" exception from Parcel
        // on the first rebuild.
        //
        // It looks like Parcel really doesn't like it when
        // the files it watches are being modified while it's running.
        const loader_exists = await fs.exists( loader_path );
        if( loader_exists ) {
            setTimeout( () => {
                fs.writeFile( loader_path, loader );
            }, 10 );
        } else {
            await fs.writeFile( loader_path, loader );
        }

        this.addDependency( loader_path );
        this.artifact_wasm = rust_build.artifactWasm;
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
