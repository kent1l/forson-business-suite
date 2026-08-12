import React, { useState } from 'react';

/**
 * Renders the admin-uploaded brand logo (full wordmark or compact icon),
 * falling back to the given text/children when no logo has been uploaded
 * (404 from the public /api/branding/logo/:variant endpoint) or on load error.
 */
const BrandLogo = ({ variant, className = '', fallback }) => {
    const [failed, setFailed] = useState(false);

    if (failed) return fallback ?? null;

    return (
        <img
            src={`/api/branding/logo/${variant}`}
            alt="Company logo"
            className={className}
            onError={() => setFailed(true)}
        />
    );
};

export default BrandLogo;
