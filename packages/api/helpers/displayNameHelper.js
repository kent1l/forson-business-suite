// This helper function centralizes the logic for creating a part's full display name.
const constructDisplayName = (part) => {
    const displayNameParts = [];

    // Part 1: GroupName (BrandName)
    const category = `${part.group_name || ''} (${part.brand_name || ''})`.replace('()', '').trim();
    if (category) displayNameParts.push(category);

    // Part 2: Detail
    if (part.detail) displayNameParts.push(part.detail);

    // Part 3: Part Numbers
    if (part.part_numbers) displayNameParts.push(part.part_numbers);

    return displayNameParts.join(' | ');
};

module.exports = { constructDisplayName };
