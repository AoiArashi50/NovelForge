import "react"

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      mesh: any
      planeGeometry: any
      shaderMaterial: any
    }
  }
}
