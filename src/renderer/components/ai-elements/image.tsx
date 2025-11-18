import { cn } from '@/lib/utils';
import { ImageViewer } from '@/components/ImageViewer';
import type { Experimental_GeneratedImage } from 'ai';

export type ImageProps = Experimental_GeneratedImage & {
  className?: string;
  alt?: string;
};

export const Image = ({
  base64,
  uint8Array,
  mediaType,
  ...props
}: ImageProps) => {
  const src = `data:${mediaType};base64,${base64}`;

  return (
    <ImageViewer src={src} alt={props.alt} className={props.className}>
      <img
        {...props}
        alt={props.alt}
        className={cn(
          'h-auto max-w-full overflow-hidden rounded-md',
          props.className
        )}
        src={src}
      />
    </ImageViewer>
  );
};
