#[macro_use]
extern crate stdweb;

fn main() {
    stdweb::initialize();
    js!(
        alert( "Hello world!" );
    );
}
