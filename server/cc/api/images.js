/**
 * Listing image upload for /api/cc/images.
 *
 * Body: raw image bytes. Query: filename (optional). Content-Type: image/jpeg|png|webp|…
 */

const { getSdk } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');

/**
 * POST /api/cc/images
 */
exports.upload = async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw httpError(400, 'image-required', 'Choose a photo to upload.');
  }
  if (req.body.length > 10 * 1024 * 1024) {
    throw httpError(400, 'image-too-large', 'Photos must be 10 MB or smaller.');
  }

  const sdk = getSdk(req, res);
  const filename = String(req.query.filename || 'photo.jpg').replace(/[^\w.\-]+/g, '_');

  try {
    // The Sharetribe SDK accepts a Buffer as the image file body.
    const response = await sdk.images.upload(
      {
        image: req.body,
      },
      {
        expand: true,
      }
    );
    const image = response.data.data;
    const variants = image.attributes?.variants || {};
    const preview =
      variants['listing-card'] ||
      variants['scaled-medium'] ||
      variants['landscape-crop'] ||
      Object.values(variants)[0];

    res.status(201).json({
      image: {
        id: image.id.uuid,
        url: preview?.url || null,
        filename,
      },
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw httpError(401, 'sign-in-required', 'Sign in to upload a photo.');
    }
    const first = e?.data?.errors?.[0];
    throw httpError(
      e.status || 400,
      'upload-failed',
      first?.title || first?.detail || 'Could not upload that photo.'
    );
  }
};
