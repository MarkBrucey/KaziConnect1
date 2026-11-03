import Link from 'next/link';
import { buttonClass } from './ui';

export function Hero() {
  return (
    <div className="grid grid-cols-1 min-[761px]:min-h-[640px] min-[761px]:grid-cols-2">
      <div className="flex flex-col justify-center bg-sky px-5 py-12 min-[761px]:py-16 min-[761px]:pl-[max(40px,calc((100vw-1240px)/2+40px))] min-[761px]:pr-12">
        <p className="mb-[18px] mt-0 text-[15px] font-semibold tracking-[0.06em] text-[#5F6770]">KARIBU, NAIROBI</p>
        <h1 className="m-0 text-[clamp(40px,4.4vw,62px)] font-extrabold leading-[1.12] tracking-[-0.025em]">
          Kazi <span className="inline-block rounded-full bg-brown px-[0.32em] pb-[0.06em] leading-[1.12] text-white">fast</span>. No agencies. No stress.
        </h1>
        <p className="mb-10 mt-[30px] max-w-[30em] text-xl text-[#6A7178]">
          Short jobs and services near where you stay, matched by county and ready today.
        </p>
        <div className="flex flex-wrap items-center gap-7">
          <Link href="/#jobs" className={`${buttonClass('solid')} !px-10 !py-4 text-lg`}>Get started</Link>
          <Link href="/#how" className="text-lg font-semibold no-underline hover:underline">See how it works →</Link>
        </div>
      </div>
      <div role="img" aria-label="A worker pushing a wheelbarrow of soil past a block wall"
        className="order-2 min-h-[260px] bg-[#8A5A3C] bg-[url(/hero.jpg)] bg-cover bg-center min-[761px]:order-none min-[761px]:min-h-[360px]" />
    </div>
  );
}
