import { Link } from 'react-router'
import { Button } from '@workspace/react-ui/components/ui/button'
import { Heading } from '@workspace/react-ui/components/ui/heading'
import { TruckIcon, PackageIcon, ClipboardCheckIcon } from 'lucide-react'

export default function IndexPage(): JSX.Element {
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <div className="container max-w-2xl">
        <div className="flex flex-col items-center justify-center ~gap-6/8 text-center ~px-4/6 ~py-8/12">
          {/* Icon */}
          <div className="~size-16/20 rounded-full bg-primary/10 flex items-center justify-center">
            <TruckIcon className="~size-8/10 text-primary" />
          </div>

          {/* Heading */}
          <div className="flex flex-col ~gap-3/4">
            <Heading as="h1" className="~text-3xl/5xl font-bold tracking-tight">
              Get Your Moving Estimate
            </Heading>
            <p className="~text-base/xl text-muted-foreground max-w-lg mx-auto">
              Snap photos of your items, chat with our AI assistant, and get an instant moving estimate.
            </p>
          </div>

          {/* CTA Button */}
          <Link to="/estimate" className="w-full max-w-sm">
            <Button size="lg" className="w-full ~text-base/lg ~h-12/14 ~mt-2/4">
              Start Your Estimate
            </Button>
          </Link>

          {/* Features */}
          <div className="grid grid-cols-1 sm:grid-cols-3 ~gap-4/6 ~mt-4/8 w-full max-w-xl">
            <FeatureCard
              icon={<PackageIcon className="~size-5/6" />}
              title="Photo Analysis"
              description="AI-powered item detection"
            />
            <FeatureCard
              icon={<ClipboardCheckIcon className="~size-5/6" />}
              title="Instant Quote"
              description="Get pricing in minutes"
            />
            <FeatureCard
              icon={<TruckIcon className="~size-5/6" />}
              title="Easy Booking"
              description="Schedule your move"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

function FeatureCard({ icon, title, description }: FeatureCardProps): JSX.Element {
  return (
    <div className="flex flex-col items-center ~gap-2/3 ~p-4/6 rounded-lg bg-muted/50">
      <div className="text-primary">{icon}</div>
      <div className="flex flex-col ~gap-0.5/1 items-center">
        <h3 className="~text-sm/base font-semibold">{title}</h3>
        <p className="~text-xs/sm text-muted-foreground text-center">{description}</p>
      </div>
    </div>
  )
}
