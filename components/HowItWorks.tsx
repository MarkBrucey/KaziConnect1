import { Wrap } from './ui';

const STEPS = [
  { title: 'Pick a job near you', text: 'Choose the kind of work and your county to see open jobs, where they are and what they pay.' },
  { title: 'Apply in a minute', text: 'Log in, or use your student ID. Say when you can start and add a short note if you like.' },
  { title: 'Follow your application live', text: 'See the moment it is accepted. Change the date or cancel while it is waiting.' },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-cream py-14 min-[761px]:py-20">
      <Wrap>
        <h2 className="mb-3 text-4xl font-extrabold leading-[1.15] tracking-tight">How it works</h2>
        <p className="mb-9 mt-0 max-w-[40em] text-lg text-muted">Three steps, and no agency in the middle.</p>
        <ol className="m-0 grid list-none grid-cols-1 gap-7 p-0 min-[761px]:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-[14px] border border-line bg-white p-7">
              <span className="mb-4 grid size-9 place-items-center rounded-full bg-brown font-bold text-white">{i + 1}</span>
              <h3 className="mb-1.5 mt-0 text-xl font-bold">{step.title}</h3>
              <p className="m-0 text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Wrap>
    </section>
  );
}
