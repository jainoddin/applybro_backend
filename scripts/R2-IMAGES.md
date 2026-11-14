# R2 site image publishing

1. Configure `backend-api/.env` with the bucket's S3 API access key ID, secret access key, account ID, bucket name and HTTPS public base URL. Credentials never belong in frontend files.
2. Run `node backend-api/scripts/publish-site-images.cjs` from the repository root.
3. The uploader uses content-hashed object keys and verifies each public image byte-for-byte before recording its URL in `frontend-web/src/lib/image-assets.json`. Existing manifest entries survive retries.
4. The website's `siteImage()` helper uses verified manifest URLs. Until an image is verified, its original local URL remains in use.
5. Restart/rebuild the frontend after publishing. Keep local originals as backups.

Backend uploads require a successful R2 write and public URL verification. They never silently write to local disk. Admin forms only save metadata after the backend confirms `storage: "r2"` and an HTTPS URL. Database write failures return errors instead of temporary success.

Storage regression checks: `npm.cmd --prefix backend-api run build`, then `node --test backend-api/scripts/storage.test.cjs`.

Current verification: 19 page images were successfully uploaded to the user-approved shared bucket under `applybro/site/images/` and each public response was checked byte-for-byte. The frontend image manifest contains the verified URLs; the corresponding local raster copies were removed at the user's request. Brand SVGs and image source documentation remain local. Backend environment now points to the verified configuration with `R2_PREFIX=applybro`, so new admin uploads stay under `applybro/offers/`. Existing objects from other projects were not modified.
