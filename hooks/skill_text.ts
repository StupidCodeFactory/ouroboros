const FRONTMATTER = /^---\n[\s\S]*?\n---\n/

export const stripFrontmatter = (skillText: string) => skillText.replace(FRONTMATTER, '')
