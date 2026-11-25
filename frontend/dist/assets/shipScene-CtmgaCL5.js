import{at as e,ct as t,ht as n,lt as r,ot as i}from"./index-DgJiqWQI.js";import{D as a,F as o,G as s,I as c,M as l,P as u,R as d,V as f,W as p,X as m,Y as ee,_ as h,at as g,b as te,c as _,d as v,f as y,g as ne,h as re,i as ie,it as b,k as ae,l as x,nt as S,o as oe,p as se,q as ce,s as le,st as C,t as ue,tt as w,u as de,y as T,z as fe}from"./OrbitControls-C2KlVucn.js";var E={name:`CopyShader`,uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`},D=class{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error(`THREE.Pass: .render() must be implemented in derived pass.`)}dispose(){}},pe=new d(-1,1,1,-1,0,1),me=new class extends x{constructor(){super(),this.setAttribute(`position`,new h([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute(`uv`,new h([0,2,0,0,2,0],2))}},O=class{constructor(e){this._mesh=new u(me,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,pe)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}},k=class extends D{constructor(e,t=`tDiffuse`){super(),this.textureID=t,this.uniforms=null,this.material=null,e instanceof m?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=S.clone(e.uniforms),this.material=new m({name:e.name===void 0?`unspecified`:e.name,defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this._fsQuad=new O(this.material)}render(e,t,n){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=n.texture),this._fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}},A=class extends D{constructor(e,t){super(),this.scene=e,this.camera=t,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,t,n){let r=e.getContext(),i=e.state;i.buffers.color.setMask(!1),i.buffers.depth.setMask(!1),i.buffers.color.setLocked(!0),i.buffers.depth.setLocked(!0);let a,o;this.inverse?(a=0,o=1):(a=1,o=0),i.buffers.stencil.setTest(!0),i.buffers.stencil.setOp(r.REPLACE,r.REPLACE,r.REPLACE),i.buffers.stencil.setFunc(r.ALWAYS,a,4294967295),i.buffers.stencil.setClear(o),i.buffers.stencil.setLocked(!0),e.setRenderTarget(n),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(t),this.clear&&e.clear(),e.render(this.scene,this.camera),i.buffers.color.setLocked(!1),i.buffers.depth.setLocked(!1),i.buffers.color.setMask(!0),i.buffers.depth.setMask(!0),i.buffers.stencil.setLocked(!1),i.buffers.stencil.setFunc(r.EQUAL,1,4294967295),i.buffers.stencil.setOp(r.KEEP,r.KEEP,r.KEEP),i.buffers.stencil.setLocked(!0)}},j=class extends D{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}},he=class{constructor(e,t){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),t===void 0){let n=e.getSize(new b);this._width=n.width,this._height=n.height,t=new C(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:T}),t.texture.name=`EffectComposer.rt1`}else this._width=t.width,this._height=t.height;this.renderTarget1=t,this.renderTarget2=t.clone(),this.renderTarget2.texture.name=`EffectComposer.rt2`,this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new k(E),this.copyPass.material.blending=0,this.timer=new w}swapBuffers(){let e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,t){this.passes.splice(t,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){let t=this.passes.indexOf(e);t!==-1&&this.passes.splice(t,1)}isLastEnabledPass(e){for(let t=e+1;t<this.passes.length;t++)if(this.passes[t].enabled)return!1;return!0}render(e){this.timer.update(),e===void 0&&(e=this.timer.getDelta());let t=this.renderer.getRenderTarget(),n=!1;for(let t=0,r=this.passes.length;t<r;t++){let r=this.passes[t];if(r.enabled!==!1){if(r.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(t),r.render(this.renderer,this.writeBuffer,this.readBuffer,e,n),r.needsSwap){if(n){let t=this.renderer.getContext(),n=this.renderer.state.buffers.stencil;n.setFunc(t.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),n.setFunc(t.EQUAL,1,4294967295)}this.swapBuffers()}A!==void 0&&(r instanceof A?n=!0:r instanceof j&&(n=!1))}}this.renderer.setRenderTarget(t)}reset(e){if(e===void 0){let t=this.renderer.getSize(new b);this._pixelRatio=this.renderer.getPixelRatio(),this._width=t.width,this._height=t.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,t){this._width=e,this._height=t;let n=this._width*this._pixelRatio,r=this._height*this._pixelRatio;this.renderTarget1.setSize(n,r),this.renderTarget2.setSize(n,r);for(let e=0;e<this.passes.length;e++)this.passes[e].setSize(n,r)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}},ge=class extends D{constructor(e,t,n=null,r=null,i=null){super(),this.scene=e,this.camera=t,this.overrideMaterial=n,this.clearColor=r,this.clearAlpha=i,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this.isRenderPass=!0,this._oldClearColor=new v}render(e,t,n){let r=e.autoClear;e.autoClear=!1;let i,a;this.overrideMaterial!==null&&(a=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor,e.getClearAlpha())),this.clearAlpha!==null&&(i=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==1&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:n),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(i),this.overrideMaterial!==null&&(this.scene.overrideMaterial=a),e.autoClear=r}},M={name:`LuminosityHighPassShader`,uniforms:{tDiffuse:{value:null},luminosityThreshold:{value:1},smoothWidth:{value:1},defaultColor:{value:new v(0)},defaultOpacity:{value:0}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			float v = luminance( texel.xyz );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`},_e=class e extends D{constructor(e,t=1,n,r){super(),this.strength=t,this.radius=n,this.threshold=r,this.resolution=e===void 0?new b(256,256):new b(e.x,e.y),this.clearColor=new v(0,0,0),this.needsSwap=!1,this.renderTargetsHorizontal=[],this.renderTargetsVertical=[],this.nMips=5;let i=Math.round(this.resolution.x/2),a=Math.round(this.resolution.y/2);this.renderTargetBright=new C(i,a,{type:T}),this.renderTargetBright.texture.name=`UnrealBloomPass.bright`,this.renderTargetBright.texture.generateMipmaps=!1;for(let e=0;e<this.nMips;e++){let t=new C(i,a,{type:T});t.texture.name=`UnrealBloomPass.h`+e,t.texture.generateMipmaps=!1,this.renderTargetsHorizontal.push(t);let n=new C(i,a,{type:T});n.texture.name=`UnrealBloomPass.v`+e,n.texture.generateMipmaps=!1,this.renderTargetsVertical.push(n),i=Math.round(i/2),a=Math.round(a/2)}let s=M;this.highPassUniforms=S.clone(s.uniforms),this.highPassUniforms.luminosityThreshold.value=r,this.highPassUniforms.smoothWidth.value=.01,this.materialHighPassFilter=new m({uniforms:this.highPassUniforms,vertexShader:s.vertexShader,fragmentShader:s.fragmentShader}),this.separableBlurMaterials=[];let c=[6,10,14,18,22];i=Math.round(this.resolution.x/2),a=Math.round(this.resolution.y/2);for(let e=0;e<this.nMips;e++)this.separableBlurMaterials.push(this._getSeparableBlurMaterial(c[e])),this.separableBlurMaterials[e].uniforms.invSize.value=new b(1/i,1/a),i=Math.round(i/2),a=Math.round(a/2);this.compositeMaterial=this._getCompositeMaterial(this.nMips),this.compositeMaterial.uniforms.blurTexture1.value=this.renderTargetsVertical[0].texture,this.compositeMaterial.uniforms.blurTexture2.value=this.renderTargetsVertical[1].texture,this.compositeMaterial.uniforms.blurTexture3.value=this.renderTargetsVertical[2].texture,this.compositeMaterial.uniforms.blurTexture4.value=this.renderTargetsVertical[3].texture,this.compositeMaterial.uniforms.blurTexture5.value=this.renderTargetsVertical[4].texture,this.compositeMaterial.uniforms.bloomStrength.value=t,this.compositeMaterial.uniforms.bloomRadius.value=.1;let l=[1,.8,.6,.4,.2];this.compositeMaterial.uniforms.bloomFactors.value=l,this.bloomTintColors=[new g(1,1,1),new g(1,1,1),new g(1,1,1),new g(1,1,1),new g(1,1,1)],this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,this.copyUniforms=S.clone(E.uniforms),this.blendMaterial=new m({uniforms:this.copyUniforms,vertexShader:E.vertexShader,fragmentShader:E.fragmentShader,premultipliedAlpha:!0,blending:2,depthTest:!1,depthWrite:!1,transparent:!0}),this._oldClearColor=new v,this._oldClearAlpha=1,this._basic=new o,this._fsQuad=new O(null)}dispose(){for(let e=0;e<this.renderTargetsHorizontal.length;e++)this.renderTargetsHorizontal[e].dispose();for(let e=0;e<this.renderTargetsVertical.length;e++)this.renderTargetsVertical[e].dispose();this.renderTargetBright.dispose();for(let e=0;e<this.separableBlurMaterials.length;e++)this.separableBlurMaterials[e].dispose();this.compositeMaterial.dispose(),this.blendMaterial.dispose(),this._basic.dispose(),this._fsQuad.dispose()}setSize(e,t){let n=Math.round(e/2),r=Math.round(t/2);this.renderTargetBright.setSize(n,r);for(let e=0;e<this.nMips;e++)this.renderTargetsHorizontal[e].setSize(n,r),this.renderTargetsVertical[e].setSize(n,r),this.separableBlurMaterials[e].uniforms.invSize.value=new b(1/n,1/r),n=Math.round(n/2),r=Math.round(r/2)}render(t,n,r,i,a){t.getClearColor(this._oldClearColor),this._oldClearAlpha=t.getClearAlpha();let o=t.autoClear;t.autoClear=!1,t.setClearColor(this.clearColor,0),a&&t.state.buffers.stencil.setTest(!1),this.renderToScreen&&(this._fsQuad.material=this._basic,this._basic.map=r.texture,t.setRenderTarget(null),t.clear(),this._fsQuad.render(t)),this.highPassUniforms.tDiffuse.value=r.texture,this.highPassUniforms.luminosityThreshold.value=this.threshold,this._fsQuad.material=this.materialHighPassFilter,t.setRenderTarget(this.renderTargetBright),t.clear(),this._fsQuad.render(t);let s=this.renderTargetBright;for(let n=0;n<this.nMips;n++)this._fsQuad.material=this.separableBlurMaterials[n],this.separableBlurMaterials[n].uniforms.colorTexture.value=s.texture,this.separableBlurMaterials[n].uniforms.direction.value=e.BlurDirectionX,t.setRenderTarget(this.renderTargetsHorizontal[n]),t.clear(),this._fsQuad.render(t),this.separableBlurMaterials[n].uniforms.colorTexture.value=this.renderTargetsHorizontal[n].texture,this.separableBlurMaterials[n].uniforms.direction.value=e.BlurDirectionY,t.setRenderTarget(this.renderTargetsVertical[n]),t.clear(),this._fsQuad.render(t),s=this.renderTargetsVertical[n];this._fsQuad.material=this.compositeMaterial,this.compositeMaterial.uniforms.bloomStrength.value=this.strength,this.compositeMaterial.uniforms.bloomRadius.value=this.radius,this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,t.setRenderTarget(this.renderTargetsHorizontal[0]),t.clear(),this._fsQuad.render(t),this._fsQuad.material=this.blendMaterial,this.copyUniforms.tDiffuse.value=this.renderTargetsHorizontal[0].texture,a&&t.state.buffers.stencil.setTest(!0),this.renderToScreen?(t.setRenderTarget(null),this._fsQuad.render(t)):(t.setRenderTarget(r),this._fsQuad.render(t)),t.setClearColor(this._oldClearColor,this._oldClearAlpha),t.autoClear=o}_getSeparableBlurMaterial(e){let t=[],n=e/3;for(let r=0;r<e;r++)t.push(.39894*Math.exp(-.5*r*r/(n*n))/n);return new m({defines:{KERNEL_RADIUS:e},uniforms:{colorTexture:{value:null},invSize:{value:new b(.5,.5)},direction:{value:new b(.5,.5)},gaussianCoefficients:{value:t}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				#include <common>

				varying vec2 vUv;

				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float gaussianCoefficients[KERNEL_RADIUS];

				void main() {

					float weightSum = gaussianCoefficients[0];
					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * weightSum;

					for ( int i = 1; i < KERNEL_RADIUS; i ++ ) {

						float x = float( i );
						float w = gaussianCoefficients[i];
						vec2 uvOffset = direction * invSize * x;
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += ( sample1 + sample2 ) * w;

					}

					gl_FragColor = vec4( diffuseSum, 1.0 );

				}`})}_getCompositeMaterial(e){return new m({defines:{NUM_MIPS:e},uniforms:{blurTexture1:{value:null},blurTexture2:{value:null},blurTexture3:{value:null},blurTexture4:{value:null},blurTexture5:{value:null},bloomStrength:{value:1},bloomFactors:{value:null},bloomTintColors:{value:null},bloomRadius:{value:0}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				varying vec2 vUv;

				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor( const in float factor ) {

					float mirrorFactor = 1.2 - factor;
					return mix( factor, mirrorFactor, bloomRadius );

				}

				void main() {

					// 3.0 for backwards compatibility with previous alpha-based intensity
					vec3 bloom = 3.0 * bloomStrength * (
						lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 2 ] ) * bloomTintColors[ 2 ] * texture2D( blurTexture3, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 3 ] ) * bloomTintColors[ 3 ] * texture2D( blurTexture4, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 4 ] ) * bloomTintColors[ 4 ] * texture2D( blurTexture5, vUv ).rgb
					);

					float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );
					gl_FragColor = vec4( bloom, bloomAlpha );

				}`})}};_e.BlurDirectionX=new b(1,0),_e.BlurDirectionY=new b(0,1);var N={name:`OutputShader`,uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`},ve=class extends D{constructor(){super(),this.isOutputPass=!0,this.uniforms=S.clone(N.uniforms),this.material=new p({name:N.name,uniforms:this.uniforms,vertexShader:N.vertexShader,fragmentShader:N.fragmentShader}),this._fsQuad=new O(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,t,n){this.uniforms.tDiffuse.value=n.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},y.getTransfer(this._outputColorSpace)===`srgb`&&(this.material.defines.SRGB_TRANSFER=``),this._toneMapping===1?this.material.defines.LINEAR_TONE_MAPPING=``:this._toneMapping===2?this.material.defines.REINHARD_TONE_MAPPING=``:this._toneMapping===3?this.material.defines.CINEON_TONE_MAPPING=``:this._toneMapping===4?this.material.defines.ACES_FILMIC_TONE_MAPPING=``:this._toneMapping===6?this.material.defines.AGX_TONE_MAPPING=``:this._toneMapping===7?this.material.defines.NEUTRAL_TONE_MAPPING=``:this._toneMapping===5&&(this.material.defines.CUSTOM_TONE_MAPPING=``),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}};function P(e,t=Math.PI/3){let n=Math.cos(t),r=(1+1e-10)*100,i=[new g,new g,new g],a=new g,o=new g,s=new g,c=new g;function l(e){return`${~~(e.x*r)},${~~(e.y*r)},${~~(e.z*r)}`}let u=e.index?e.toNonIndexed():e,d=u.attributes.position,f={};for(let e=0,t=d.count/3;e<t;e++){let t=3*e,n=i[0].fromBufferAttribute(d,t+0),r=i[1].fromBufferAttribute(d,t+1),s=i[2].fromBufferAttribute(d,t+2);a.subVectors(s,r),o.subVectors(n,r);let c=new g().crossVectors(a,o).normalize();for(let e=0;e<3;e++){let t=i[e],n=l(t);n in f||(f[n]=[]),f[n].push(c)}}let p=new Float32Array(d.count*3),m=new _(p,3,!1);for(let e=0,t=d.count/3;e<t;e++){let t=3*e,r=i[0].fromBufferAttribute(d,t+0),u=i[1].fromBufferAttribute(d,t+1),p=i[2].fromBufferAttribute(d,t+2);a.subVectors(p,u),o.subVectors(r,u),s.crossVectors(a,o).normalize();for(let e=0;e<3;e++){let r=i[e],a=f[l(r)];c.set(0,0,0);for(let e=0,t=a.length;e<t;e++){let t=a[e];s.dot(t)>n&&c.add(t)}c.normalize(),m.setXYZ(t+e,c.x,c.y,c.z)}}return u.setAttribute(`normal`,m),u}var{L:F,B:ye,D:I}={L:280,B:46,D:26},L=ye/2,R=5,z=160,B=1.1,be=924203,xe=10273525,Se=7071937,Ce=30,V=e=>Math.max(0,Math.min(1,e)),H=(e,t,n)=>{let r=V((n-e)/(t-e));return r*r*(3-2*r)},we=()=>typeof window<`u`&&!!window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches,U=e=>I*(1+.1*H(.9,1,e)),W=e=>e<.13?.48*I*((.13-e)/.13)**2:0;function G(e,t){let n=1;if(e>.74&&(n*=1-V((e-.74)/.26)**(1.4+2*t)),e<.24){let r=V((.24-e)/.24);n*=1-r**1.7*(1-.84*H(.3,.95,t))}return Math.max(0,n)}function Te(e,t){let n=V((e-.9)/.1)**2,r=.03*F*H(.3,1,t)*n,i=.02*F*Math.exp(-(((t-.26)/.16)**2))*n,a=e<.05?-.014*F*H(.45,1,t)*(1-e/.05):0;return r+i+a}var Ee=(()=>{let e=[];for(let t=0;t<=5;t+=1)e.push([(L-R)*(t/5),0]);for(let t=1;t<=8;t+=1){let n=-Math.PI/2+Math.PI/2*(t/8);e.push([L-R+R*Math.cos(n),R+R*Math.sin(n)])}for(let t=1;t<=10;t+=1)e.push([L,R+(I-R)*(t/10)]);return e})();function De(e){let t=W(e),n=U(e);return Ee.map(([r,i])=>{let a=t+i*(n-t)/I,o=a/n;return{y:r*G(e,o),z:a,zf:o}})}function K(e,t){if(t<=e[0].z){let t=0;for(let n of e)n.z-e[0].z<1e-6&&(t=n.y);return t}for(let n=0;n<e.length-1;n+=1){let r=e[n],i=e[n+1];if(i.z>r.z&&t>=r.z&&t<=i.z)return r.y+(i.y-r.y)*(t-r.z)/(i.z-r.z)}return e[e.length-1].y}function q(e,t){let n=new x;return n.setAttribute(`position`,new h(e,3)),t&&n.setAttribute(`normal`,new h(t,3)),n}var J=(e,t=Math.PI/5)=>{let n=P(q(e),t);return n.computeBoundingBox(),n.computeBoundingSphere(),n},Oe=(e,t,n,r)=>e.push(t.x,t.y,t.z,n.x,n.y,n.z,r.x,r.y,r.z),Y=(e,t,n,r,i)=>{Oe(e,t,n,r),Oe(e,t,r,i)};function X(e,t,n,r,i,a,o){let s=new le(n-t,i-r,o-a).toNonIndexed();s.translate((t+n)/2,(r+i)/2,(a+o)/2),e.push(...s.attributes.position.array),s.dispose()}function ke(){let e=[];for(let t=0;t<=z;t+=1){let n=t/z,r=De(n),i=(e,t)=>new g(n*F+Te(n,e.zf),t*e.y,e.z);e.push([...r.slice(1).reverse().map(e=>i(e,1)),...r.map(e=>i(e,-1))])}let t=e.length,n=e[0].length,r=Ee.length-1,i=(r,i)=>e[Math.max(0,Math.min(t-1,r))][Math.max(0,Math.min(n-1,i))],a=e.map((e,t)=>e.map((e,n)=>{let r=new g().crossVectors(new g().subVectors(i(t+1,n),i(t-1,n)),new g().subVectors(i(t,n+1),i(t,n-1)));return r.lengthSq()<1e-12&&r.set(e.x>F/2?1:-1,0,0),r.normalize(),r.dot(new g(0,e.y,e.z-I*.55))<0&&Math.abs(e.y)>.01&&r.negate(),r})),o=[],s=[],c=(t,n)=>{let r=e[t][n],i=a[t][n];o.push(r.x,r.y,r.z),s.push(i.x,i.y,i.z)};for(let e=0;e<t-1;e+=1)for(let t=0;t<n-1;t+=1)c(e,t),c(e+1,t),c(e+1,t+1),c(e,t),c(e+1,t+1),c(e,t+1);for(let t=0;t<r;t+=1)for(let n of[e[0][r-t],e[0][r+t],e[0][r+t+1],e[0][r-t],e[0][r+t+1],e[0][r-t-1]])o.push(n.x,n.y,n.z),s.push(-1,0,0);let l=[],u=e=>new g(e.x,e.y*.985,e.z+.05);for(let r=0;r<t-1;r+=1)Y(l,u(e[r][0]),u(e[r][n-1]),u(e[r+1][n-1]),u(e[r+1][0]));let d=[],f=e=>{for(let t=0;t<e.length-1;t+=1)d.push(e[t].x,e[t].y,e[t].z,e[t+1].x,e[t+1].y,e[t+1].z)};f(e.map(e=>e[0])),f(e.map(e=>e[n-1])),f(e.map(e=>e[r])),f(e[0]);let p=[],m=I*.6;for(let e of[1,-1]){let t=[];for(let n=0;n<=z;n+=1){let r=n/z,i=De(r);W(r)>m||t.push(new g(r*F+Te(r,m/U(r)),e*K(i,m),m))}for(let e=0;e<t.length-1;e+=1)p.push(t[e].x,t[e].y,t[e].z,t[e+1].x,t[e+1].y,t[e+1].z)}let ee=q(o,s);return ee.computeBoundingSphere(),{shell:ee,deck:J(l,Math.PI/3),outline:q(d),water:q(p)}}function Ae({x:[e,t],z:[n,r]}){let i=Math.max(3,Math.round((t-e)*110)),a=[];for(let o=0;o<=i;o+=1){let s=e+(t-e)*o/i,c=De(s),l=U(s),u=W(s),d=Math.max(n*I,u)+B*.7,f=Math.max(d+.3,(r>=1?l:r*I)-B*.7),p=[];for(let e=0;e<=9;e+=1){let t=d+(f-d)*e/9;p.push(new g(s*F+Te(s,t/l),-Math.max(.06,K(c,t)-B),t))}a.push([...p,...p.slice().reverse().map(e=>new g(e.x,-e.y,e.z))])}let o=[],s=a[0].length;for(let e=0;e<i;e+=1)for(let t=0;t<s;t+=1)Y(o,a[e][t],a[e+1][t],a[e+1][(t+1)%s],a[e][(t+1)%s]);let c=(e,t)=>{for(let n=0;n<9;n+=1){let r=[e[n],e[n+1],e[s-2-n],e[s-1-n]];t&&r.reverse(),Y(o,...r)}};return c(a[0],!1),c(a[i],!0),J(o)}function je(){let e=[],n=t.x[0]*F,r=t.x[1]*F,i=t.halfWidth*L;return X(e,n,r,-i,i,I+.1,I+11),X(e,n+.01*F,r-.004*F,-i*.82,i*.82,I+11,I+15.4),X(e,r-.042*F,r,-L*1.02,L*1.02,I+15.4,I+18.2),X(e,r-.036*F,r-.008*F,-i*.5,i*.5,I+18.2,I+19.2),J(e,Math.PI/6)}function Me(){let e=[],n=i.x[0]*F,r=i.x[1]*F,a=i.halfWidth*L;X(e,n,r,-a,a,I,I+19),X(e,n-.4,r+.4,-a-.4,a+.4,I+19,I+21.3),X(e,t.x[1]*F-6.4,t.x[1]*F-5.6,-.4,.4,I+19.2,I+27),X(e,t.x[1]*F-7.6,t.x[1]*F-4.4,-3.2,3.2,I+24.4,I+24.8);let o=U(.955);X(e,.955*F-.4,.955*F+.4,-.4,.4,o,o+13),X(e,.255*F,.865*F,-1.1,1.1,I+2.4,I+2.9);for(let t=0;t<=10;t+=1){let n=(.255+.061*t)*F;X(e,n-.25,n+.25,-.25,.25,I,I+2.4)}for(let t of[.535,.55,.565])X(e,t*F-.5,t*F+.5,-L*.96,L*.96,I+1.2,I+2.2);for(let[t,n]of[[.5,1],[.6,-1]])X(e,t*F-.8,t*F+.8,n*7-.8,n*7+.8,I,I+12),X(e,t*F-.5,t*F+12,n*7-.4,n*7+.4,I+11,I+11.8);X(e,.006*F,.03*F,-.45,.45,I*.05,I*.5);let s=new se(4.2,4.2,.5,24).toNonIndexed();s.rotateZ(Math.PI/2),s.translate(.04*F,0,I*.2),e.push(...s.attributes.position.array),s.dispose();let c=new se(.9,.5,3,12).toNonIndexed();return c.rotateZ(Math.PI/2),c.translate(.046*F,0,I*.2),e.push(...c.attributes.position.array),c.dispose(),J(e,Math.PI/6)}function Ne(){return new m({transparent:!0,depthWrite:!1,side:2,uniforms:{uColor:{value:new v(4022162)},uRim:{value:new v(12179199)},uFade:{value:1},uFrame:{value:7}},vertexShader:`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,fragmentShader:`
      uniform vec3 uColor; uniform vec3 uRim; uniform float uFade; uniform float uFrame;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float fx = vP.x / uFrame;
        float frame = 1.0 - smoothstep(0.0, 1.4, abs(fract(fx - 0.5) - 0.5) / max(fwidth(fx), 1e-5));
        float alpha = (0.045 + fres * 0.6 + frame * 0.085) * uFade;
        gl_FragColor = vec4(mix(uColor, uRim, fres), alpha);
        #include <colorspace_fragment>
      }`})}function Pe(){return new m({transparent:!0,depthWrite:!1,uniforms:{uColor:{value:new v(4876951)}},vertexShader:`
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,fragmentShader:`
      uniform vec3 uColor; varying vec2 vP;
      float grid(vec2 p, float cell) {
        vec2 g = abs(fract(p / cell - 0.5) - 0.5) / max(fwidth(p / cell), vec2(1e-5));
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float fade = 1.0 - smoothstep(0.12, 0.5, length(vP) / ${(F*7).toFixed(1)});
        float a = (grid(vP, 20.0) * 0.16 + grid(vP, 100.0) * 0.22) * fade;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`})}function Fe(){let e=document.createElement(`canvas`);e.width=256,e.height=256;let t=e.getContext(`2d`);if(!t)return null;let n=t.createRadialGradient(128,128,0,128,128,128);n.addColorStop(0,`rgba(74,122,196,0.42)`),n.addColorStop(.55,`rgba(46,80,127,0.16)`),n.addColorStop(1,`rgba(14,26,43,0)`),t.fillStyle=n,t.fillRect(0,0,256,256);let r=new de(e);return r.colorSpace=ce,r}var Ie={iso:[.46,-1,.46],side:[0,-1,.03],top:[0,-.03,1],bow:[.92,-.72,.34]},Le={선미부:[-78,44],기관실:[-30,96],거주구:[-52,-66],상갑판:[48,-84],화물창:[8,108],이중저:[132,92],선수부:[72,46]},Re=`pointer-events-auto inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-meta font-medium transition-colors duration-150 ease-out`;function Z({canvas:t,overlay:i,onPick:d,onHover:p}){let m=new ie({canvas:t,antialias:!0});m.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));let h=new ee;h.background=new v(be);let _=new fe(Ce,1,2,F*30);_.up.set(0,0,1);let y=new g(F*.5,0,I*.6),x=new ue(_,t);x.enableDamping=!1,x.target.copy(y),x.minDistance=F*.2,x.maxDistance=F*4,x.autoRotateSpeed=.7,h.add(new te(13624063,726566,1.1));let S=new re(16777215,1.5);S.position.set(F*.3,-F*.8,F*1.1),h.add(S);let se=new re(9417968,.6);se.position.set(F*1.1,F*.7,F*.2),h.add(se);let ce=new u(new f(F*7,F*7),Pe());ce.position.set(F*.5,0,-7),h.add(ce);let le=Fe();if(le){let e=new u(new f(F*1.9,ye*6.5),new o({map:le,transparent:!0,depthWrite:!1,fog:!1}));e.position.set(F*.5,0,-6.9),h.add(e)}let w=ke(),de=Ne(),E=new u(w.shell,de);E.renderOrder=3,h.add(E);let D=new a({color:11127029,transparent:!0,opacity:.75,fog:!1});h.add(new ae(w.outline,D));let pe=new a({color:7071937,transparent:!0,opacity:.28,fog:!1});h.add(new ae(w.water,pe));let me=new c({color:8166603,emissive:1785454,emissiveIntensity:.6,roughness:.6,transparent:!0,opacity:.5,fog:!1}),O=new u(Me(),me);O.renderOrder=1,h.add(O);let k={},A=[],j=(e,t,n=!1)=>{let r=k[e]||(k[e]={meshes:[],edges:[],box:new oe,deck:n}),i=new c({color:3101320,emissive:3101320,emissiveIntensity:.4,roughness:.5,metalness:.08,transparent:!0,opacity:1,side:2,fog:!1,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1}),o=new u(t,i);o.userData.zone=e,o.renderOrder=n?2:0;let s=new ae(new ne(t,n?60:32),new a({color:xe,transparent:!0,opacity:.5,fog:!1}));h.add(o,s),r.meshes.push(o),r.edges.push(s),A.push(o),t.computeBoundingBox(),r.box.union(t.boundingBox)};for(let t of e)j(t.zone,Ae(t));j(`상갑판`,w.deck,!0),j(`거주구`,je());for(let e of r){let t=k[e.name];t.inside=e.inside,t.center=t.box.getCenter(new g),t.anchor=t.center.clone(),e.name===`상갑판`?t.anchor.set(F*.66,-L*.5,I+.2):e.name===`거주구`?t.anchor.z=t.box.max.z-2:t.anchor.y=-L*.55,t.cur={op:0,glow:0,edge:0},t.to={op:0,glow:0,edge:0}}let M={cur:{shell:1,detail:.5},to:{shell:1,detail:.5}},N=`http://www.w3.org/2000/svg`,P=document.createElementNS(N,`svg`);Object.assign(P.style,{position:`absolute`,inset:`0`,width:`100%`,height:`100%`,pointerEvents:`none`}),P.setAttribute(`aria-hidden`,`true`),i?.appendChild(P);let R={},z={},B=0,V=null,H=null;for(let e of r){let t=document.createElementNS(N,`line`);t.setAttribute(`stroke`,`#8A9DB8`),t.setAttribute(`stroke-width`,`1`);let n=document.createElementNS(N,`circle`);n.setAttribute(`r`,`2.5`),n.setAttribute(`fill`,`#DCEEFF`),P.append(t,n);let r=document.createElement(`button`);r.type=`button`,Object.assign(r.style,{position:`absolute`,left:`0px`,top:`0px`,whiteSpace:`nowrap`});let a=document.createElement(`span`);a.setAttribute(`aria-hidden`,`true`),a.className=`inline-block h-2.5 w-2.5 rounded-[3px]`;let o=document.createElement(`span`);o.textContent=e.name;let s=document.createElement(`span`);s.className=`font-mono font-medium`,r.append(a,o,s),r.addEventListener(`click`,()=>d?.(e.name)),r.addEventListener(`pointerenter`,()=>Q(e.name)),r.addEventListener(`pointerleave`,()=>{H===e.name&&Q(null)}),r.addEventListener(`focus`,()=>Q(e.name)),r.addEventListener(`blur`,()=>{H===e.name&&Q(null)}),i?.appendChild(r),R[e.name]={el:r,sw:a,num:s,line:t,dot:n}}let U=null,W=null;try{let e=m.getDrawingBufferSize(new b);U=new he(m,new C(Math.max(1,e.x),Math.max(1,e.y),{type:T,samples:4})),U.addPass(new ge(h,_)),W=new _e(new b(e.x,e.y),.38,.55,.72),U.addPass(W),U.addPass(new ve)}catch{U=null}let G=new g;function Te(){let e=t.clientWidth,n=t.clientHeight;for(let t of r){let{el:r,line:i,dot:a}=R[t.name];G.copy(k[t.name].anchor).project(_);let o=(G.x+1)/2*e,s=(1-G.y)/2*n,[c,l]=Le[t.name],u=Math.max(48,Math.min(e-48,o+c)),d=Math.max(18,Math.min(n-18,s+l)),f=G.z<1&&o>-40&&o<e+40&&s>-40&&s<n+40;r.style.display=f?``:`none`,i.style.display=f?``:`none`,a.style.display=f?``:`none`,r.style.transform=`translate(${u}px, ${d}px) translate(-50%, -50%)`,i.setAttribute(`x1`,o),i.setAttribute(`y1`,s),i.setAttribute(`x2`,u),i.setAttribute(`y2`,d),a.setAttribute(`cx`,o),a.setAttribute(`cy`,s)}}function Ee(){for(let e of r){let t=k[e.name];for(let e of t.meshes)e.material.opacity=t.cur.op,e.material.depthWrite=t.cur.op>.9,e.material.emissiveIntensity=t.cur.glow;for(let e of t.edges)e.material.opacity=t.cur.edge}de.uniforms.uFade.value=M.cur.shell,me.opacity=M.cur.detail,D.opacity=.35+.4*M.cur.shell}function De(){Ee(),U?U.render():m.render(h,_),Te()}let K=new Map,q=0,J=!1;function Oe(e){q=0;let t=!1;for(let[n,r]of K){let i=Math.min(1,(e-r.t0)/r.dur);r.apply(i>=1?1:1-2**(-9*i)),i>=1?K.delete(n):t=!0}J&&(x.update(),t=!0),De(),t&&(q=requestAnimationFrame(Oe))}let Y=()=>{q||=requestAnimationFrame(Oe)};function X(e,t,n){if(we()||t<=0){K.delete(e),n(1),Y();return}K.set(e,{t0:performance.now(),dur:t,apply:n}),Y()}function Z(e=320){for(let e of r){let t=k[e.name],r=z[e.name]||0,i=e.name===V,a=!!V&&!i,o=e.name===H,s=n(r,B);for(let e of t.meshes)e.material.color.set(s),e.material.emissive.set(s);for(let e of t.edges)e.material.color.set(i?Se:xe);let c=r?t.deck?.3:1:.05;i?c=r?t.deck?.85:1:.22:a&&(c*=t.deck?.2:.14),t.to.op=c,t.to.glow=(r?t.deck?.22:.36:.1)+(i?.1:0)+(o?.16:0),t.to.edge=i?1:a?.14:o?.95:r?.5:.42,t.from={...t.cur};let{el:l,sw:u,num:d}=R[e.name];l.className=`${Re} ${i?`border-n-0 bg-n-0 text-navy-900`:`bg-navy-950/85 hover:border-on-navy-ring ${r?`border-navy-600 text-on-navy`:`border-navy-700 text-on-navy-subtle`}`}`,l.setAttribute(`aria-pressed`,i?`true`:`false`),l.setAttribute(`aria-label`,`${e.name}: 자료 ${r}건`),l.style.opacity=a?`0.55`:`1`,u.style.background=r?s:`transparent`,u.style.border=r?`none`:`1px dashed #8A9DB8`,d.textContent=String(r)}let i=V&&k[V]?.inside;M.to.shell=V?i?.42:.7:1,M.to.detail=V?.16:.5,M.from={...M.cur},t.style.cursor=H?`pointer`:``;let a=(e,t,n)=>e+(t-e)*n;X(`style`,e,e=>{for(let t of r){let n=k[t.name];for(let t of[`op`,`glow`,`edge`])n.cur[t]=a(n.from[t],n.to[t],e)}for(let t of[`shell`,`detail`])M.cur[t]=a(M.from[t],M.to[t],e)})}function Q(e,t){if(e===H){e&&p?.(e,t||null);return}H=e,p?.(e,t||null),Z(140)}let ze=`iso`,Be=e=>{let t=Math.tan(l.degToRad(Ce/2)),n=_.aspect||1,r=F*.6,i=e===`top`?ye*.9:I*1.5;return Math.max(r/(t*n),i/t)*({iso:1.22,bow:1}[e]||1.16)};function Ve(e,t,n,r=700){let i={target:x.target.clone(),dir:_.position.clone().sub(x.target),dist:0};i.dist=i.dir.length(),i.dir.normalize();let a={target:e.clone(),dir:(t||i.dir).clone().normalize(),dist:n},o=new g;X(`camera`,r,e=>{x.target.lerpVectors(i.target,a.target,e),o.lerpVectors(i.dir,a.dir,e),o.lengthSq()<1e-6&&o.copy(a.dir),o.normalize(),_.position.copy(x.target).addScaledVector(o,i.dist+(a.dist-i.dist)*e),_.lookAt(x.target),e>=1&&x.update()})}function He(e=null,t=700){let n=V&&k[V];if(!n||n.deck){Ve(y,e,Be(ze),t);return}let r=n.box.getSize(new g),i=Math.max(r.x,r.y*1.6,r.z*2.6);Ve(n.center,e,Math.min(Be(ze),Math.max(F*.8,i*1.5+F*.5)),t)}function Ue(e=`iso`,t=700){ze=Ie[e]?e:`iso`,He(new g(...Ie[ze]),t)}let We=new s,Ge=new b,Ke=e=>{let n=t.getBoundingClientRect();Ge.set((e.clientX-n.left)/n.width*2-1,-((e.clientY-n.top)/n.height)*2+1),We.setFromCamera(Ge,_);let r=We.intersectObjects(A,!1);if(!r.length)return null;let i=r[0].object.userData.zone;return i===`상갑판`&&r[1]&&Math.abs(We.ray.direction.z)<.5?r[1].object.userData.zone:i},$=null,qe=e=>{$=[e.clientX,e.clientY],K.delete(`camera`)},Je=e=>{$&&Math.hypot(e.clientX-$[0],e.clientY-$[1])<4&&d?.(Ke(e)),$=null},Ye=e=>{e.buttons||Q(Ke(e),{x:e.clientX,y:e.clientY})},Xe=()=>Q(null),Ze=()=>K.delete(`camera`);t.addEventListener(`pointerdown`,qe),t.addEventListener(`pointerup`,Je),t.addEventListener(`pointermove`,Ye),t.addEventListener(`pointerleave`,Xe),t.addEventListener(`wheel`,Ze,{passive:!0}),x.addEventListener(`change`,Y);function Qe(){let e=t.clientWidth,n=t.clientHeight;e&&n&&(m.setSize(e,n,!1),U?.setPixelRatio(m.getPixelRatio()),U?.setSize(e,n),_.aspect=e/n,_.updateProjectionMatrix(),Y())}Qe();let $e=new g(...Ie.iso).normalize().applyAxisAngle(new g(0,0,1),-.6);return _.position.copy(y).addScaledVector($e,Be(`iso`)*1.35),_.lookAt(y),x.update(),Z(0),Ve(y,new g(...Ie.iso),Be(`iso`),1300),{setCounts(e,t){z=e||{},B=t||0,Z(420)},select(e){let t=e&&k[e]?e:null;t!==V&&(V=t,Z(380),He())},setView:Ue,setAutoRotate(e){J=!!e,x.autoRotate=J,J&&K.delete(`camera`),Y()},resize:Qe,dispose(){q&&cancelAnimationFrame(q),K.clear(),t.removeEventListener(`pointerdown`,qe),t.removeEventListener(`pointerup`,Je),t.removeEventListener(`pointermove`,Ye),t.removeEventListener(`pointerleave`,Xe),t.removeEventListener(`wheel`,Ze),x.dispose(),Object.values(R).forEach(e=>e.el.remove()),P.remove(),h.traverse(e=>{e.geometry?.dispose?.(),(Array.isArray(e.material)?e.material:[e.material]).forEach(e=>{e?.map?.dispose?.(),e?.dispose?.()})}),W?.dispose?.(),U?.dispose?.(),m.dispose()}}}export{Z as createShipScene};