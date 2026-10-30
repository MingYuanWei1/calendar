import {z} from 'zod';

// 材料: what an administrator pastes or adds for the model to read — pasted text, screenshots, photos and rendered
// PDF pages, numbered Material 1… in order. The model cites that number as source.page.
export const MAX_MATERIALS=12;
export const partSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('text'),text:z.string().trim().min(1).max(20000)}),
 z.object({kind:z.literal('image'),image:z.string().max(8000000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),text:z.string().max(20000).default('')})
]);
export const partsSchema=z.array(partSchema).min(1).max(MAX_MATERIALS);
/** An error message when the materials are too large to send, else null. */
export const materialsTooLarge=parts=>parts.reduce((n,p)=>n+(p.kind==='image'?p.image.length:p.text.length),0)>16000000?'材料过大，请减少图片或拆分 PDF。':null;
/** The materials as model message content, each introduced by its number. */
export const materialContent=parts=>parts.flatMap((part,i)=>part.kind==='text'
 ?[{type:'text',text:`Material ${i+1} (pasted text):\n${part.text}`}]
 :[{type:'text',text:`Material ${i+1} (image${part.text?`; embedded PDF text: ${part.text}`:''}):`},{type:'image_url',image_url:{url:part.image}}]);
