use base64::{Engine, prelude::BASE64_STANDARD};
use http_body_util::BodyExt;
use serde::Deserialize;
use std::io::Cursor;

use serde_json::{Value, json};
use vercel_runtime::{Error, Request, run, service_fn};

#[tokio::main]
async fn main() -> Result<(), Error> {
    let service = service_fn(handler);
    run(service).await
}

#[derive(Deserialize)]
struct CheckRequest {
    objects: String,
    license: Option<String>,
}

fn read_from_base64(encoded: String) -> Result<String, Error> {
    let decoded = BASE64_STANDARD.decode(encoded)?;

    Ok(String::from_utf8(decoded)?)
}

async fn handler(req: Request) -> Result<Value, Error> {
    let bytes = req.collect().await?.to_bytes();
    let req: CheckRequest = serde_json::from_slice(&bytes)?;

    let license = match req.license {
        Some(license) => Some(read_from_base64(license)?),
        None => None,
    };

    let objects = Cursor::new(BASE64_STANDARD.decode(req.objects)?);

    let result = bclicensechecker::compare(license, objects)?;

    Ok(json!({
        "objects": Value::Array(result.0.iter().map(|object| json!({
            "type": object.object_type.format(),
            "id": object.id,
            "name": object.name,
        })).collect()),
        "ranges": Value::Array(result.1.iter().map(|range| json!({
            "type": range.object_type.format(),
            "from": range.range_from,
            "to": range.range_to,
        })).collect()),
    }))
}
