import type { AstroInstance } from 'astro';
import { Github, Instagram } from 'lucide-astro';

export interface SocialLink {
	name: string;
	url: string;
	icon: AstroInstance;
}

export default {
	title: 'petrovisuals',
	favicon: 'favicon.ico',
	owner: 'petrovisuals',
	profileImage: 'profile.webp',
	socialLinks: [
		{
			name: 'Instagram',
			url: 'https://www.instagram.com/petrovisual.s',
			icon: Instagram,
		} as SocialLink,
	],
};
