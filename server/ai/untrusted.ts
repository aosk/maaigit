/**
 * Words written by other people (an email, a calendar invite, an Asana comment) are handed to Claude
 * inside tags such as <email_content> and <context>, with an instruction that they are information,
 * never orders. That only holds if the text cannot close the tag itself and carry on as if it were
 * outside it, so any tag-like opening or closing of our own tags is defused here.
 */
const OUR_TAGS = /<(\/?\s*(?:email_content|asana_task|news_item|device_output|about_the_user|context|message|system|assistant|user|instructions?)\b)/gi;

export const neutralize = (text: string): string => text.replace(OUR_TAGS, '‹$1');
