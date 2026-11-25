import{E as e,T as t,b as n,v as r,x as i,y as a}from"./ViewportOverlays-BxHDOkaB.js";import{$ as o,G as s,J as c,K as l,Q as u,W as d,X as f,Y as p,Z as m,nt as h,q as g,tt as _}from"./index-Jm60K3OC.js";import{$ as v,A as y,B as ee,C as b,D as x,E as te,F as ne,G as S,H as re,I as ie,J as C,K as ae,L as oe,M as se,N as ce,O as le,P as ue,Q as w,R as de,S as fe,T,U as pe,W as me,X as E,Y as D,Z as he,_ as O,a as ge,b as _e,c as k,d as ve,et as ye,f as be,h as xe,i as Se,j as Ce,k as we,l as A,n as Te,nt as Ee,o as De,p as Oe,q as j,r as M,t as ke,tt as Ae,u as je,v as Me,w as Ne,x as Pe,y as Fe,z as Ie}from"./OrbitControls-CmjmCqcf.js";import{r as Le}from"./cameraSync-CjWboI4O.js";var N=new De,P=new v,Re=class extends _e{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new xe([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new xe([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new Pe(t,6,1);return this.setAttribute(`instanceStart`,new b(n,3,0)),this.setAttribute(`instanceEnd`,new b(n,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new Pe(t,6,1);return this.setAttribute(`instanceColorStart`,new b(n,3,0)),this.setAttribute(`instanceColorEnd`,new b(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new Ee(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new De);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),N.setFromBufferAttribute(t),this.boundingBox.union(N))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new j),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)P.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(P)),P.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(P));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}};M.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new w(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},Te.line={uniforms:E.merge([M.common,M.fog,M.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		void trimSegment( const in vec4 start, inout vec4 end ) {

			// trim end segment so it terminates between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
			float nearEstimate = - 0.5 * b / a;

			float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

			end.xyz = mix( start.xyz, end.xyz, alpha );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
				vUv = uv;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					trimSegment( start, end );

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					trimSegment( end, start );

				}

			}

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};var ze=class extends S{constructor(e){super({type:`LineMaterial`,uniforms:E.clone(Te.line.uniforms),vertexShader:Te.line.vertexShader,fragmentShader:Te.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return`WORLD_UNITS`in this.defines}set worldUnits(e){e===!0!==this.worldUnits&&(this.needsUpdate=!0),e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return`USE_DASH`in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return`USE_ALPHA_TO_COVERAGE`in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE=``:delete this.defines.USE_ALPHA_TO_COVERAGE)}},Be=new ye,Ve=new v,He=new v,F=new ye,I=new ye,L=new ye,Ue=new v,R=new Ce,z=new Ne,B=new v,We=new De,Ge=new j,V=new ye,H,Ke;function U(e,t,n){return V.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),V.multiplyScalar(1/V.w),V.x=Ke/n.width,V.y=Ke/n.height,V.applyMatrix4(e.projectionMatrixInverse),V.multiplyScalar(1/V.w),Math.abs(Math.max(V.x,V.y))}function qe(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){z.start.fromBufferAttribute(i,r),z.end.fromBufferAttribute(a,r),z.applyMatrix4(n);let o=new v,s=new v;H.distanceSqToSegment(z.start,z.end,s,o),s.distanceTo(o)<Ke*.5&&t.push({point:s,pointOnLine:o,distance:H.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,uv1:null})}}function Je(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;H.at(1,L),L.w=1,L.applyMatrix4(t.matrixWorldInverse),L.applyMatrix4(r),L.multiplyScalar(1/L.w),L.x*=i.x/2,L.y*=i.y/2,L.z=0,Ue.copy(L),R.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(F.fromBufferAttribute(s,t),I.fromBufferAttribute(c,t),F.w=1,I.w=1,F.applyMatrix4(R),I.applyMatrix4(R),F.z>u&&I.z>u)continue;if(F.z>u){let e=F.z-I.z,t=(F.z-u)/e;F.lerp(I,t)}else if(I.z>u){let e=I.z-F.z,t=(I.z-u)/e;I.lerp(F,t)}F.applyMatrix4(r),I.applyMatrix4(r),F.multiplyScalar(1/F.w),I.multiplyScalar(1/I.w),F.x*=i.x/2,F.y*=i.y/2,I.x*=i.x/2,I.y*=i.y/2,z.start.copy(F),z.start.z=0,z.end.copy(I),z.end.z=0;let o=z.closestPointToPointParameter(Ue,!0);z.at(o,B);let l=y.lerp(F.z,I.z,o),d=l>=-1&&l<=1,f=Ue.distanceTo(B)<Ke*.5;if(d&&f){z.start.fromBufferAttribute(s,t),z.end.fromBufferAttribute(c,t),z.start.applyMatrix4(a),z.end.applyMatrix4(a);let r=new v,i=new v;H.distanceSqToSegment(z.start,z.end,i,r),n.push({point:i,pointOnLine:r,distance:H.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,uv1:null})}}}var Ye=class extends se{constructor(e=new Re,t=new ze({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)Ve.fromBufferAttribute(t,e),He.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+Ve.distanceTo(He);let i=new Pe(r,2,1);return e.setAttribute(`instanceDistanceStart`,new b(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new b(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;H=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;Ke=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),Ge.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?Ke*.5:U(r,Math.max(r.near,Ge.distanceToPoint(H.origin)),s.resolution),Ge.radius+=c,H.intersectsSphere(Ge)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),We.copy(o.boundingBox).applyMatrix4(a);let l;l=n?Ke*.5:U(r,Math.max(r.near,We.distanceToPoint(H.origin)),s.resolution),We.expandByScalar(l),H.intersectsBox(We)!==!1&&(n?qe(this,t):Je(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(Be),this.material.uniforms.resolution.value.set(Be.z,Be.w))}},Xe=[0,0,1],Ze=[1,0,0],Qe=.001,W={length:0,fallback:!1};function $e(e,t,n,r,i,a,o,s,c,l,u){let d=a-n,f=o-r,p=s-i,m=Math.hypot(d,f,p);if(W.fallback=!1,!(m>0))return e.fill(0,t,t+16),W.length=0,W;d/=m,f/=m,p/=m;let h=Math.hypot(c,l,u),g=f*u-p*l,_=p*c-d*u,v=d*l-f*c,y=Math.hypot(g,_,v);if(!(h>0)||y<Qe*h){W.fallback=!0;let e=Math.abs(p)<.95?Xe:Ze;g=f*e[2]-p*e[1],_=p*e[0]-d*e[2],v=d*e[1]-f*e[0],y=Math.hypot(g,_,v)}g/=y,_/=y,v/=y;let ee=_*p-v*f,b=v*d-g*p,x=g*f-_*d;return e[t]=d*m,e[t+1]=f*m,e[t+2]=p*m,e[t+3]=0,e[t+4]=ee,e[t+5]=b,e[t+6]=x,e[t+7]=0,e[t+8]=g,e[t+9]=_,e[t+10]=v,e[t+11]=0,e[t+12]=n,e[t+13]=r,e[t+14]=i,e[t+15]=1,W.length=m,W}function et({positions:e,beams:t,orient:n=null,offsets:r=null},i,a,o=0,s=i.length){let c=0;for(let l=o;l<s;l+=1){let o=i[l],s=t[o*4+2]*3,u=t[o*4+3]*3,d=e[s],f=e[s+1],p=e[s+2],m=e[u],h=e[u+1],g=e[u+2];if(r){let e=o*6;d+=r[e],f+=r[e+1],p+=r[e+2],m+=r[e+3],h+=r[e+4],g+=r[e+5]}let _=o*3;(n?$e(a,l*16,d,f,p,m,h,g,n[_],n[_+1],n[_+2]):$e(a,l*16,d,f,p,m,h,g,0,0,0)).fallback&&(c+=1)}return c}var tt=1710638,nt=855322,rt={conm2:8,spc:7},it=6,at=10,G={core:m.core,outline:m.outline,elemPx:6,elemOutlinePx:10,nodePx:14,nodeOutlinePx:18},ot={metalness:.15,roughness:.55,flatShading:!0},K=5,st=new v(0,0,1),ct=35,lt=92,ut=10,dt=2e4,ft=2e5,pt=723734,mt=[];function q(e){e.traverse(e=>{e.geometry?.dispose?.(),(Array.isArray(e.material)?e.material:e.material?[e.material]:[]).forEach(e=>{e.userData?.sharedMap||e.map?.dispose?.(),e.dispose()})})}function ht(){this.array=null}var gt=()=>Math.min(window.devicePixelRatio||1,2),J=null;function _t(){if(J)return J;let e=document.createElement(`canvas`);e.width=32,e.height=32;let t=e.getContext(`2d`);return t&&(t.fillStyle=`#ffffff`,t.beginPath(),t.arc(16,16,15,0,Math.PI*2),t.fill()),J=new je(e),J}var vt=null;function yt(){if(vt)return vt;let e=document.createElement(`canvas`);e.width=32,e.height=32;let t=e.getContext(`2d`);return t&&(t.strokeStyle=`#ffffff`,t.lineWidth=6,t.beginPath(),t.arc(16,16,12,0,Math.PI*2),t.stroke()),vt=new je(e),vt}var bt=()=>new Promise(e=>{setTimeout(e,0)}),xt=`
attribute float lbGroup;
varying float vLbGroup;
uniform sampler2D uGroupVis;
uniform float uGroupVisW;
uniform float uNoGroup;
`,Y=`
vLbGroup = lbGroup;
{
  float lbG = lbGroup < -0.5 ? uNoGroup : lbGroup;
  ivec2 lbC = ivec2(int(mod(lbG, uGroupVisW)), int(floor(lbG / uGroupVisW)));
  if (texelFetch(uGroupVis, lbC, 0).r < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`,St=`
varying float vLbGroup;
uniform float uColorByGroup;
uniform vec3 uGroupPalette[${g.length}];
uniform vec3 uNoGroupColor;
`,X=`
if (uColorByGroup > 0.5) {
  diffuseColor.rgb = vLbGroup < -0.5 ? uNoGroupColor
    : uGroupPalette[int(mod(floor(vLbGroup + 0.5), ${g.length}.0))];
}
`,Z=`
attribute float lbClass;
varying float vLbClass;
uniform vec3 uClassMask;
uniform float uDepthBias;
`,Ct=`
vLbClass = lbClass;
{
  int lbK = int(lbClass + 0.5);
  float lbOn = lbK == 0 ? uClassMask.x : lbK == 1 ? uClassMask.y : uClassMask.z;
  if (lbOn < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // 깊이만 카메라 쪽으로 당긴다 — 절점이 1D 단면·쉘 면에 파묻히지 않게(화면 위치는 그대로).
  gl_Position.z -= uDepthBias * gl_Position.w;
}
`,wt=`
varying float vLbClass;
uniform vec3 uClassColors[3];
`,Tt=`
{
  vec2 lbP = gl_PointCoord * 2.0 - 1.0;
  float lbR = dot(lbP, lbP);
  if (lbR > 1.0) discard;
  int lbK = int(vLbClass + 0.5);
  vec3 lbCol = lbK == 0 ? uClassColors[0] : lbK == 1 ? uClassColors[1] : uClassColors[2];
  // 바깥 고리를 어둡게 — 밝은 쉘 위에서도 점의 모양이 보이게
  diffuseColor.rgb = lbR > 0.45 ? lbCol * 0.42 : lbCol;
}
`;function Q(e,t,{colorable:n=!1,node:r=!1}={}){return e.onBeforeCompile=e=>{Object.assign(e.uniforms,t);let i=e.vertexShader.replace(`#include <common>`,`#include <common>\n${xt}${r?Z:``}`).replace(`#include <project_vertex>`,`#include <project_vertex>\n${Y}${r?Ct:``}`),a=e.fragmentShader;(n||r)&&(a=a.replace(`#include <common>`,`#include <common>\n${St}${r?wt:``}`).replace(`#include <color_fragment>`,`#include <color_fragment>\n${r?Tt:X}`)),e.vertexShader=i,e.fragmentShader=a},e.customProgramCacheKey=()=>`lb:${n?`c`:``}${r?`n`:``}`,e}function Et(e){let t=[e.outer,...e.hole?[e.hole]:[]],n=t.reduce((e,t)=>e+t.length,0),r=new Float32Array(n*2*3),i=0,a=[];for(let e of t){a.push(i);for(let[t,a]of e)r[i*3]=0,r[i*3+1]=t,r[i*3+2]=a,r[(i+n)*3]=1,r[(i+n)*3+1]=t,r[(i+n)*3+2]=a,i+=1}let o=[];t.forEach((e,t)=>{let r=a[t];for(let t=0;t<e.length;t+=1){let i=r+t,a=r+(t+1)%e.length;o.push(i,a,a+n,i,a+n,i+n)}});let s=e.outer.map(([e,t])=>new w(e,t)),c=e.hole?[e.hole.map(([e,t])=>new w(e,t))]:[];for(let[e,t,r]of ae.triangulateShape(s,c))o.push(e,r,t,e+n,t+n,r+n);let l=new A;return l.setAttribute(`position`,new k(r,3)),l.setIndex(o),l}function Dt(){let e=new me,t=[[`x`,[1,0,0]],[`y`,[0,1,0]],[`z`,[0,0,1]]],n=[],r=[];for(let[e,i]of t){let t=new ve(s[e]);n.push(0,0,0,...i),r.push(t.r,t.g,t.b,t.r,t.g,t.b)}let i=new A;i.setAttribute(`position`,new xe(n,3)),i.setAttribute(`color`,new xe(r,3)),e.add(new x(i,new T({vertexColors:!0,depthTest:!1})));for(let[n,r]of t){let t=document.createElement(`canvas`);t.width=64,t.height=64;let i=t.getContext(`2d`);i&&(i.font=`600 46px "Pretendard Variable", "Segoe UI", sans-serif`,i.textAlign=`center`,i.textBaseline=`middle`,i.fillStyle=s[n],i.fillText(n.toUpperCase(),32,34));let a=new je(t);a.colorSpace=pe;let o=new C(new D({map:a,depthTest:!1}));o.position.set(r[0]*1.3,r[1]*1.3,r[2]*1.3),o.scale.setScalar(.62),e.add(o)}return{scene:e,camera:new ie(-1.6,1.6,1.6,-1.6,-10,10)}}function Ot(s){let m=s.clientWidth||800,y=s.clientHeight||500,b=new Se({antialias:!0});b.setPixelRatio(gt()),b.setSize(m,y,!1),b.outputColorSpace=pe,b.toneMapping=0;let S=b.domElement;S.style.width=`100%`,S.style.height=`100%`,S.style.display=`block`,s.appendChild(S);let C=new me;C.background=new ve(tt);let ae=m/y,w=new ie(-ae,ae,1,-1,-100,100),E=new oe(ct,ae,.1,1e3);w.up.copy(st),E.up.copy(st);let D=w;C.add(new Me(14215935,4013384,1.25)),C.add(new ge(16777215,.28));let _e=new Oe(16777215,.55);_e.position.set(4,-5,7);let ye=new Oe(10471679,.35);ye.position.set(-5,4,5),C.add(_e,ye);let Te=new O,Ee=new Oe(16777215,1);Ee.position.set(.5,1,.5),Te.add(Ee),D.add(Te),C.add(w,E);let De=Dt(),j=mt,M=new de(new v(1,0,0),0),je=0;function Ne(){b.clippingPlanes=mt,b.autoClear=!1,b.setScissorTest(!0),b.setScissor(ut,ut,lt,lt),b.setViewport(ut,ut,lt,lt),b.setClearColor(nt,1),b.clear(),b.setScissorTest(!1),b.setClearColor(tt,1),De.camera.quaternion.copy(D.quaternion),De.camera.updateMatrixWorld(),b.render(De.scene,De.camera);let{w:e,h:t}=Ct();b.setViewport(0,0,e,t),b.autoClear=!0,b.clippingPlanes=j}let Pe=()=>{je=0,b.clippingPlanes=j,b.render(C,D),F&&Ne()},N=()=>{je||=requestAnimationFrame(Pe)},P=new ke(D,S);P.enableDamping=!1,P.zoomToCursor=!0,P.screenSpacePanning=!0,P.mouseButtons={LEFT:we.ROTATE,MIDDLE:we.DOLLY,RIGHT:we.PAN},P.addEventListener(`change`,N);let Be=new Set,Ve=0,He=()=>{if(!Ve)for(let e of Be)e()};P.addEventListener(`change`,He);let F=null,I=null,L=null,Ue=null,R=null,z=null,B=null,We=new Map,Ge=new Set,V=!0,H=`pid`,Ke=`line`,U=null,qe={},Je={rbe2:!0,rbe3:!0,conm2:!0,spc:!0},Xe=null,Ze=null,Qe={visible:!1,classes:[!0,!0,!0]},W=null,$e=0,J=null,vt=null,xt=null,Y=null,St=null,X=null,Z=null;function Ct(){return{w:s.clientWidth||1,h:s.clientHeight||1}}function wt(){X&&=(q(X.scene),X.target.dispose(),null)}let Tt=null,Ot=typeof window.requestIdleCallback==`function`;function kt(){Tt!=null&&(Ot?window.cancelIdleCallback(Tt):clearTimeout(Tt),Tt=null)}let At=e=>{e.preventDefault(),cancelAnimationFrame(je),je=0,kt()},jt=()=>{je=0,wt(),F&&Zt(),N()};S.addEventListener(`webglcontextlost`,At),S.addEventListener(`webglcontextrestored`,jt);function Mt(e){let t=new A;return t.setAttribute(`position`,L),t.setAttribute(`lbGroup`,Ue),t.setIndex(new k(e,1)),t}function Nt(){vt&&=(C.remove(vt),q(vt),null)}function Pt(){Y&&=(C.remove(Y.obj),q(Y.obj),null)}function Ft(){xt&&=(C.remove(xt),q(xt),null)}function It(){Ze&&=(C.remove(Ze),q(Ze),null)}function Lt(){if($e+=1,W){C.remove(W.root),q(W.root);for(let e of W.pick.values())e.removeFromParent(),q(e);W=null}}function Rt(){kt(),Nt(),Pt(),It(),Ft(),xn(),Lt(),wt(),B&&=(C.remove(B),q(B),null),U&&=(C.remove(U),q(U),null),Xe&&=(C.remove(Xe),q(Xe),null),z?.dispose(),z=null,We.clear(),Ge.clear();for(let e of Object.keys(qe))delete qe[e];F=null,I=null,L=null,Ue=null,R=null,J=null,Ke=`line`}function zt(e,t,n=[0,0,0],r=F?.radius){if(!F)return;let{w:o,h:s}=Ct(),c=o/s,l=new v(...e).normalize(),u=new v(...n),d=F.radius;if(D===w){let e=a({dir:l.toArray(),up:t},r,c);w.left=-e.halfWidth,w.right=e.halfWidth,w.top=e.halfHeight,w.bottom=-e.halfHeight,w.near=-(d*20+r*4),w.far=r*4+d*20,w.zoom=1,w.position.copy(u).addScaledVector(l,r*4)}else{let e=i(r,ct,c);E.aspect=c,E.near=Math.max(e*.001,d*1e-5),E.far=e+d*8,E.position.copy(u).addScaledVector(l,e)}if(Math.abs(l.dot(st))>.999){let e=new v(...t).normalize().multiplyScalar(-r*.004);D.position.add(e)}D.up.copy(st),P.target.copy(u),D.updateProjectionMatrix(),P.update(),N()}function Bt(e,t){let n=D.position.clone().sub(P.target);n.lengthSq()===0&&n.set(...r.iso.dir);let i=new v(0,1,0).applyQuaternion(D.quaternion);zt(n.normalize().toArray(),i.toArray(),e,t)}function Vt(e){if(e===D||!F)return;let t=P.target.clone(),n=D.position.clone().sub(t),r=n.length()||F.radius*4;n.normalize();let{w:i,h:a}=Ct(),o=i/a,s=Math.tan(ct*Math.PI/360);if(e===E){let e=(w.top-w.bottom)/(2*w.zoom)/s;E.aspect=o,E.near=Math.max(e*.001,F.radius*1e-5),E.far=e+F.radius*8,E.position.copy(t).addScaledVector(n,e)}else{let e=r*s;w.top=e,w.bottom=-e,w.left=-e*o,w.right=e*o,w.zoom=1,w.near=-F.radius*24,w.far=F.radius*24,w.position.copy(t).addScaledVector(n,F.radius*4)}e.quaternion.copy(D.quaternion),e.up.copy(st),e.add(Te),D=e,D.updateProjectionMatrix(),P.object=D,P.target.copy(t),P.update(),N()}function Ht(){return Ke===`section`&&!!W?.ready}function Ut(e,t,n){return Z?l.unchanged:H===`type`?o(t):H===`section`?h(n):_(e)}function Wt(){if(!R)return;R.uColorByGroup.value=+(H===`group`&&!Z);let e=I?.plan;for(let[t,n]of We){let r=e?.ranges.get(t)||[];n.beamMats.forEach((e,i)=>e.color.set(Ut(t,n.beamCards[i],r[i]?.type||`LINE`))),n.shellMats.forEach((e,r)=>e.color.set(Ut(t,n.shellCards[r],u.has(n.shellCards[r])?`SOLID`:`SHELL`))),n.edgeMat&&(H===`pid`&&!Z?n.edgeMat.color.set(_(t)).multiplyScalar(.4):n.edgeMat.color.setHex(pt))}for(let e of W?.meshes||[])e.mat.color.set(Ut(e.bucket.pid,e.bucket.card,e.bucket.section.type));N()}function $(){let e=Ht(),t=!!Y;B&&(B.visible=!t);for(let[n,r]of We){let i=!Ge.has(n);if(r.root.visible=i,r.edges&&(r.edges.visible=V),r.beams){let t=I?.plan?.ranges.get(n)||[];r.beams.geometry.groups.forEach((n,i)=>{n.materialIndex=e&&t[i]?.sectioned?r.beamMats.length:i})}let a=X?.groups.get(n);if(a){a.visible=i&&!t;let r=a.userData.lines;if(r){let t=I?.plan?.ranges.get(n)||[];r.geometry.groups.forEach((n,r)=>{n.materialIndex=e&&t[r]?.sectioned?1:0})}}let o=W?.pick.get(n);o&&(o.visible=i&&e&&!t)}if(W){W.root.visible=e&&!t;for(let e of W.meshes)e.mesh.visible=!Ge.has(e.bucket.pid)}for(let[e,t]of Object.entries(qe))t.visible=!!Je[e];if(U&&(U.visible=!t),Ze&&(Ze.visible=!t),xt&&(xt.visible=!t),X?.rigid)for(let e of[`rbe2`,`rbe3`])X.rigid[e]&&(X.rigid[e].visible=!!Je[e]&&!t);Xe&&(Xe.visible=Qe.visible&&!t,R.uClassMask.value.set(...Qe.classes.map(e=>+!!e)),R.uDepthBias.value=e?.004:.0015),Z&&Cn(e,t),N()}function Gt(e){let t=e+1,n=Math.min(t,4096),r=Math.ceil(t/n),i=new Uint8Array(n*r);i.fill(255,0,t);let a=new be(i,n,r,re,he);return a.needsUpdate=!0,J=i,{tex:a,w:n}}function Kt(e){U=new O;let t=(e,t)=>{if(!t.length)return;let n=new x(Mt(t),Q(new T({color:c[e]}),R));n.renderOrder=2,qe[e]=n,U.add(n)},n=(e,t)=>{if(!t.length)return;let n=new Ie(Mt(t),Q(new ee({color:c[e],size:rt[e],sizeAttenuation:!1}),R));n.renderOrder=3,qe[e]=n,U.add(n)};t(`rbe2`,e.rigid.rbe2),t(`rbe3`,e.rigid.rbe3),n(`conm2`,e.masses),n(`spc`,e.spcs),C.add(U)}function qt(){let e=F.positions.length/3,t=new Float32Array(e),n=I?.check?.cls;if(n)for(let r=0;r<e;r+=1)t[r]=n[r];let r=new A;r.setAttribute(`position`,L),r.setAttribute(`lbGroup`,Ue),r.setAttribute(`lbClass`,new k(t,1));let i=Q(new ee({color:16777215,size:it,sizeAttenuation:!1}),R,{node:!0});Xe=new Ie(r,i),Xe.renderOrder=4,Xe.visible=!1,C.add(Xe)}function Jt(){let e=new me,t=new Map,n=F.positions,r=I?.groups?.nodeGroup,i=Q(new ce({vertexColors:!0,side:2,toneMapped:!1,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1}),R),a=Q(new T({vertexColors:!0,toneMapped:!1}),R),o=new T({visible:!1}),s=(e,t,i,a=0)=>{let o=e.length,s=new Float32Array(o*3),c=new Uint8Array(o*3),l=new Float32Array(o);for(let u=0;u<o;u+=1){let o=e[u],d=u*3;s[d]=n[o*3],s[d+1]=n[o*3+1],s[d+2]=n[o*3+2],l[u]=r?r[o]:0;let f=a+t[u/i|0]+1;c[d]=f&255,c[d+1]=f>>8&255,c[d+2]=f>>16&255}let u=new A;return u.setAttribute(`position`,new k(s,3).onUpload(ht)),u.setAttribute(`color`,new k(c,3,!0).onUpload(ht)),u.setAttribute(`lbGroup`,new k(l,1).onUpload(ht)),u.computeBoundingSphere(),u},c=(e,t)=>{t.frustumCulled=!1,e.add(t)};for(let n of F.groups){let r=new O;if(n.shell.length&&c(r,new se(s(n.shell,n.shellElem,3),i)),n.beams.length){let e=s(n.beams,n.beamElem,2);(n.beamRanges||[{start:0,count:n.beams.length}]).forEach(t=>e.addGroup(t.start,t.count,0));let t=new x(e,[a,o]);r.userData.lines=t,c(r,t)}t.set(n.pid,r),e.add(r)}let l={},u=I?.rigids;if(u&&I.blocks.rigid_lines?.length){let t=I.blocks.rigid_lines;for(let[n,r]of[[`rbe2`,0],[`rbe3`,1]]){let i=[];for(let e=0;e<u.ofLine.length;e+=1)I.blocks.rigid_kinds[e]===r&&i.push(e);if(!i.length)continue;let o=new Uint32Array(i.length*2),d=new Int32Array(i.length);i.forEach((e,n)=>{o[n*2]=t[e*3+1],o[n*2+1]=t[e*3+2],d[n]=u.ofLine[e]});let f=new x(s(o,d,2,F.total),a);c(e,f),l[n]=f}}if(X={scene:e,groups:t,rigid:l,target:new Ae(K,K,{minFilter:ne,magFilter:ne,depthBuffer:!0})},W)for(let[e,n]of W.pick)t.get(e)?.add(n);$()}function Yt(e,t,n,r,i=X.scene,a=X.target){let o=b.outputColorSpace,s=b.getClearColor(new ve),c=b.getClearAlpha(),l=new Uint8Array(100);try{D.updateMatrixWorld(),D.setViewOffset(n,r,e-2,t-2,K,K),b.outputColorSpace=le,b.setClearColor(0,0),b.setRenderTarget(a),b.clippingPlanes=j,b.clear(),b.render(i,D),b.readRenderTargetPixels(a,0,0,K,K,l)}finally{b.setRenderTarget(null),b.outputColorSpace=o,b.setClearColor(s,c),D.clearViewOffset()}return l}function Xt(){if(!X||b.getContext().isContextLost())return;let e=[...X.groups.values(),...Object.values(X.rigid)],t=e.map(e=>e.visible);for(let t of e)t.visible=!0;let n=j;j=mt;try{let{w:e,h:t}=Ct();Yt(0,0,e,t)}finally{j=n,e.forEach((e,n)=>{e.visible=t[n]})}}function Zt(){kt();let e=()=>{Tt=null,F&&!X&&(Jt(),Xt())};Tt=Ot?window.requestIdleCallback(e,{timeout:2e3}):setTimeout(e,200)}let Qt=new Ce;function $t(e,t,n,r){if(!Xe?.visible||!F)return null;D.updateMatrixWorld(),Qt.multiplyMatrices(D.projectionMatrix,D.matrixWorldInverse);let i=Qt.elements,a=F.positions,o=I?.groups?.nodeGroup,s=I?.check?.cls,c=J?J.length:0,l=null,u=1/0,d=1/0,f=a.length/3;for(let p=0;p<f;p+=1){if(s&&!Qe.classes[s[p]])continue;if(J&&o){let e=o[p]<0?I.groups.count:o[p];if(e<c&&J[e]===0)continue}let f=a[p*3],m=a[p*3+1],h=a[p*3+2];if(j.length&&M.normal.x*f+M.normal.y*m+M.normal.z*h+M.constant<0)continue;let g=i[3]*f+i[7]*m+i[11]*h+i[15];if(g<=0)continue;let _=((i[0]*f+i[4]*m+i[8]*h+i[12])/g*.5+.5)*n,v=(1-((i[1]*f+i[5]*m+i[9]*h+i[13])/g*.5+.5))*r,y=(_-e)**2+(v-t)**2;if(y>49)continue;let ee=(i[2]*f+i[6]*m+i[10]*h+i[14])/g;(y<u-1||Math.abs(y-u)<=1&&ee<d)&&(l=p,u=y,d=ee)}return l}async function en(e){let t=++$e,n=I?.plan,r=new O;r.visible=!1;let i=new Map,a=[],o=n?.beams||0,s={positions:F.positions,beams:I.blocks.beams,orient:I.orient||null,offsets:I.offsets||null},c=I.groups?.elemGroup,l=0,u=0;e?.(0);for(let d of n?.buckets||[]){let n=d.rows.length,f=Et(d.profile),p=new Float32Array(n);for(let e=0;e<n;e+=1)p[e]=c?c[d.elems[e]]:0;f.setAttribute(`lbGroup`,new Fe(p,1));let m=Q(new ue({color:_(d.pid),side:2,...ot}),R,{colorable:!0}),h=new fe(f,m,n);h.frustumCulled=!1;let g=h.instanceMatrix.array;for(let i=0;i<n;i+=dt){let a=Math.min(n,i+dt);if(u+=et(s,d.rows,g,i,a),l+=a-i,o>dt&&(e?.(l/o),await bt(),t!==$e))return f.dispose(),m.dispose(),q(r),null}h.instanceMatrix.needsUpdate=!0,r.add(h);let v=new Float32Array(n*3);for(let e=0;e<n;e+=1){let t=d.elems[e]+1;v[e*3]=(t&255)/255,v[e*3+1]=(t>>8&255)/255,v[e*3+2]=(t>>16&255)/255}let y=Q(new ce({toneMapped:!1,side:2}),R),ee=new fe(f,y,n);ee.instanceMatrix=h.instanceMatrix,ee.instanceColor=new Fe(v,3),ee.frustumCulled=!1;let b=i.get(d.pid);b||(b=new O,i.set(d.pid,b)),b.add(ee),a.push({mesh:h,bucket:d,mat:m})}if(t!==$e)return q(r),null;if(C.add(r),W={root:r,meshes:a,pick:i,ready:!0,fallbacks:u},X)for(let[e,t]of i)X.groups.get(e)?.add(t);return e?.(1),W}let tn=e=>{let t=F.positions;return[t[e*3],t[e*3+1],t[e*3+2]]},nn=new Set;function rn(e,t,n,r,i){let a=new Re;a.setPositions(e);let o=new ze({color:t,linewidth:n,transparent:!0,opacity:r,depthTest:!1,worldUnits:!1}),{w:s,h:c}=Ct();o.resolution.set(s,c),nn.add(o),o.addEventListener(`dispose`,()=>nn.delete(o));let l=new Ye(a,o);return l.renderOrder=i,l}function an(e,t,n){let r=new A;return r.setAttribute(`position`,new xe(e,3)),new x(r,new T({color:t,depthTest:n}))}function on(e,t,n,r,i=1){return sn(e.flatMap(tn),t,n,r,i)}function sn(e,t,n,r,i=1,a=_t()){let o=new A;o.setAttribute(`position`,new xe(e,3));let s=new ee({color:t,size:n,sizeAttenuation:!1,depthTest:r,map:a,alphaTest:.5,transparent:i<1,opacity:i});return s.userData.sharedMap=!0,new Ie(o,s)}let cn=e=>e==null?null:typeof e==`number`?{kind:`element`,index:e}:e;function ln(n){if(!F||!I)return null;if(n.kind===`element`){if(n.index<0||n.index>=F.total)return null;let e=t(I,F,n.index);return{nodes:e,segs:e.length===2?[...tn(e[0]),...tn(e[1])]:e.flatMap((t,n)=>[...tn(t),...tn(e[(n+1)%e.length])]),beam:e.length===2}}if(n.kind===`node`)return{nodes:[n.index],segs:[],beam:!1};let r=Z?.spec?.ghost;if(n.kind===`ghost`&&r&&n.index<r.items.length){let e=r.items[n.index],t=e=>[r.positions[e*3],r.positions[e*3+1],r.positions[e*3+2]],i=e.nodes,a;return a=e.type===`rigid`?i.slice(1).flatMap(e=>[...t(i[0]),...t(e)]):i.length===2?[...t(i[0]),...t(i[1])]:i.flatMap((e,n)=>[...t(e),...t(i[(n+1)%i.length])]),{nodes:[],segs:a,beam:i.length===2,points:e.type===`rigid`?t(i[0]):null}}if(n.kind===`ghost-node`&&r&&n.index<r.nodes.length){let e=r.nodes[n.index];return{nodes:[],segs:[],beam:!1,points:[r.positions[e*3],r.positions[e*3+1],r.positions[e*3+2]]}}if(n.kind===`rbe`&&I.rigids&&n.index<I.rigids.count){let t=e(I,I.rigids,n.index);return{nodes:t,segs:t.slice(1).flatMap(e=>[...tn(t[0]),...tn(e)]),beam:!1}}return null}function un(e){let n=[];for(let r=0;r<F.total;r+=1)t(I,F,r).includes(e)&&n.push(r);return n}function dn(e){let t=F.elemRow[e],n=F.elemKind[e],r=I.blocks;return n===0?r.beams[t*4+1]:n===1?r.tris[t*5+1]:r.quads[t*6+1]}function fn(e,n){let r=t(I,F,e);if(r.length===2){if(Ht()){let t=W.meshes.find(t=>t.bucket.elems.includes(e));if(t){let r=t.bucket.elems.indexOf(e),i=new se(t.mesh.geometry.clone(),new ue({color:t.mat.color,side:2,...ot}));i.geometry.deleteAttribute(`lbGroup`),i.matrixAutoUpdate=!1,i.matrix.fromArray(t.mesh.instanceMatrix.array,r*16),n.add(i);return}}n.add(an([...tn(r[0]),...tn(r[1])],_(dn(e)),!0));return}let i=r.length===3?[r]:[[r[0],r[1],r[2]],[r[0],r[2],r[3]]],a=new A;a.setAttribute(`position`,new xe(i.flat().flatMap(tn),3)),n.add(new se(a,new ue({color:_(dn(e)),side:2,...ot,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1})))}function pn(e,t,n){e.transparent!==t&&(e.transparent=t,e.needsUpdate=!0),e.opacity=t?n:1,e.depthWrite=!t}function mn(e){for(let t of We.values()){for(let n of t.shellMats)pn(n,e,.16);for(let n of t.beamMats)pn(n,e,.34);t.edgeMat&&(t.edgeMat.opacity=e?.14:.55,t.edgeMat.depthWrite=!e)}for(let t of W?.meshes||[])pn(t.mat,e,.14)}function hn(e,t,n,r,i){let a=t.length/2,o=new Float32Array(a*6),s=new Float32Array(a*2);for(let n=0;n<a;n+=1){for(let r=0;r<2;r+=1){let i=t[n*2+r];o[n*6+r*3]=e[i*3],o[n*6+r*3+1]=e[i*3+1],o[n*6+r*3+2]=e[i*3+2]}s[n*2+1]=8}let c=new A;c.setAttribute(`position`,new k(o,3)),c.setAttribute(`lineDistance`,new k(s,1));let l=new x(c,new te({color:n,dashSize:1,gapSize:1,transparent:r<1,opacity:r,depthWrite:!1}));return l.renderOrder=i,l}function gn(e,t){let n=new Float32Array(t.length*3);for(let r=0;r<t.length;r+=1){let i=t[r];n[r*3]=e[i*3],n[r*3+1]=e[i*3+1],n[r*3+2]=e[i*3+2]}return n}function _n(e,t,n,r,{opacity:i=1,dashed:a=!1}={}){let o=new Re;o.setPositions(e);let s=new ze({color:t,linewidth:n,transparent:i<1,opacity:i,worldUnits:!1}),{w:c,h:l}=Ct();s.resolution.set(c,l),nn.add(s),s.addEventListener(`dispose`,()=>nn.delete(s));let u=new Ye(o,s);if(a){u.computeLineDistances();let t=0,n=e.length/6;for(let r=0;r<n;r+=1)t+=Math.hypot(e[r*6+3]-e[r*6],e[r*6+4]-e[r*6+1],e[r*6+5]-e[r*6+2]);let r=Math.max(t/Math.max(n,1)/8,1e-9);s.dashed=!0,s.dashSize=r,s.gapSize=r}return u.renderOrder=r,u}function vn(e,t,n,r,i){let a=t.length,o=new Float32Array(a*3),s=new Uint8Array(a*3);for(let c=0;c<a;c+=1){let a=t[c];o[c*3]=e[a*3],o[c*3+1]=e[a*3+1],o[c*3+2]=e[a*3+2];let l=i+n[c/r|0]+1;s[c*3]=l&255,s[c*3+1]=l>>8&255,s[c*3+2]=l>>16&255}let c=new A;return c.setAttribute(`position`,new k(o,3)),c.setAttribute(`color`,new k(s,3,!0)),c.computeBoundingSphere(),c}function yn(){Z?.focus&&(C.remove(Z.focus),q(Z.focus),Z.focus=null)}function bn(){Z?.section&&(C.remove(Z.section),q(Z.section),Z.section=null)}function xn(){Z&&=(yn(),bn(),C.remove(Z.root),q(Z.root),q(Z.pick),Z.target.dispose(),null)}function Sn(){if(bn(),!Z||!W?.ready)return;let e=Z.spec.elemClass;if(!e)return;let t=new O,n=I?.groups?.elemGroup,r=Q(new ue({color:16777215,side:2,...ot}),R),i=new ve;for(let a of W.meshes){let o=a.bucket.elems;for(let s of[1,2]){let c=[];for(let t=0;t<o.length;t+=1)e[o[t]]===s&&c.push(t);if(!c.length)continue;let u=a.mesh.geometry,d=new A;d.setAttribute(`position`,u.getAttribute(`position`)),d.setIndex(u.getIndex());let f=new Float32Array(c.length);c.forEach((e,t)=>{f[t]=n?n[o[e]]:0}),d.setAttribute(`lbGroup`,new Fe(f,1));let p=new fe(d,r,c.length);p.frustumCulled=!1;let m=a.mesh.instanceMatrix.array,h=p.instanceMatrix.array;i.set(s===1?l.added:l.changed),c.forEach((e,t)=>{for(let n=0;n<16;n+=1)h[t*16+n]=m[e*16+n];p.setColorAt(t,i)}),p.instanceMatrix.needsUpdate=!0,p.userData.layer=s===1?`added`:`changed`,t.add(p)}}Z.section=t,C.add(t)}function Cn(e,t){let n=Z.layers,r=n.unchanged&&!n.onlyChanged;if(B&&(B.visible=!t&&r),W&&(W.root.visible=e&&!t&&r),U&&(U.visible=!1),X?.rigid)for(let e of[`rbe2`,`rbe3`])X.rigid[e]&&(X.rigid[e].visible=!1);for(let[e,r]of Object.entries(Z.layer))for(let i of r)i.visible=!!n[e]&&!t;for(let e of Z.pick.children)e.visible=!!n[e.userData.layer];if(Z.section){Z.section.visible=e&&!t;for(let e of Z.section.children)e.visible=!!n[e.userData.layer]}Z.focus&&(Z.focus.visible=!t)}function wn(e){let t=new O,n=new me,r={added:[],changed:[],removed:[],moved:[],spc:[]},i=F.positions,a=F.total,o=I?.rigids?.count||0,s=new ce({vertexColors:!0,side:2,toneMapped:!1}),c=new T({vertexColors:!0,toneMapped:!1}),u=(e,t)=>{e.userData.layer=t,e.frustumCulled=!1,n.add(e)},d=(e,n)=>{r[e].push(n),t.add(n)};for(let[t,n]of[[1,`added`],[2,`changed`]]){let r=l[n],o=e.buffers?.[t];if(o?.shell.length&&(d(n,new se(Mt(o.shell),Q(new ue({color:r,side:2,...ot,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1}),R))),u(new se(vn(i,o.shell,o.shellElem,3,0),s),n)),o?.edges.length){let e=new x(Mt(o.edges),Q(new T({color:new ve(r).multiplyScalar(.45)}),R));e.renderOrder=1,d(n,e)}o?.beams.length&&(d(n,_n(gn(i,o.beams),r,3,3)),u(new x(vn(i,o.beams,o.beamElem,2,0),c),n));let f=e.rigid?.[t];f?.segs.length&&(d(n,_n(gn(i,f.segs),r,2,3)),u(new x(vn(i,f.segs,f.item,2,a),c),n))}let f=(e,t,n,r)=>{if(!t?.length)return;let i=Q(new ee({color:n,size:9,sizeAttenuation:!1,depthTest:!1,map:r,alphaTest:r?.5:0}),R);r&&(i.userData.sharedMap=!0);let a=new Ie(Mt(Uint32Array.from(t)),i);a.renderOrder=7,d(e,a)};f(`added`,e.nodes?.added,l.added,_t()),f(`moved`,e.nodes?.moved,l.changed,_t()),f(`spc`,e.nodes?.spc,l.changed,null);let p=e.ghost;if(p&&p.positions.length){let e=p.positions,t=a+o,n=l.removed;if(p.shell.length){let r=new A;r.setAttribute(`position`,new k(e,3)),r.setIndex(new k(p.shell,1));let i=new se(r,new ce({color:n,transparent:!0,opacity:.26,depthWrite:!1,side:2}));i.renderOrder=4,d(`removed`,i),u(new se(vn(e,p.shell,p.shellItem,3,t),s),`removed`)}if(p.edges.length&&d(`removed`,hn(e,p.edges,n,.95,5)),p.beams.length&&(d(`removed`,_n(gn(e,p.beams),n,2,5,{dashed:!0})),u(new x(vn(e,p.beams,p.beamItem,2,t),c),`removed`)),p.rigid.length&&(d(`removed`,_n(gn(e,p.rigid),n,2,5,{dashed:!0})),u(new x(vn(e,p.rigid,p.rigidItem,2,t),c),`removed`)),p.nodes.length){let t=new Float32Array(p.nodes.length*3);p.nodes.forEach((n,r)=>{t[r*3]=e[n*3],t[r*3+1]=e[n*3+1],t[r*3+2]=e[n*3+2]});let r=sn(t,n,11,!1,1,yt());r.material.userData.sharedMap=!0,r.renderOrder=7,d(`removed`,r)}}return C.add(t),{spec:e,layers:{added:!0,changed:!0,removed:!0,moved:!0,spc:!0,unchanged:!0,onlyChanged:!1},root:t,layer:r,pick:n,target:new Ae(K,K,{minFilter:ne,magFilter:ne,depthBuffer:!0}),section:null,focus:null}}function Tn(e,t,n,r){D.updateMatrixWorld(),Qt.multiplyMatrices(D.projectionMatrix,D.matrixWorldInverse);let i=Qt.elements,a=null,o=1/0,s=(s,c,l)=>{for(let u=0;u<c.length;u+=1){let d=c[u],f=s[d*3],p=s[d*3+1],m=s[d*3+2];if(j.length&&M.normal.x*f+M.normal.y*p+M.normal.z*m+M.constant<0)continue;let h=i[3]*f+i[7]*p+i[11]*m+i[15];if(h<=0)continue;let g=((i[0]*f+i[4]*p+i[8]*m+i[12])/h*.5+.5)*n,_=(1-((i[1]*f+i[5]*p+i[9]*m+i[13])/h*.5+.5))*r,v=(g-e)**2+(_-t)**2;v<=49&&v<o&&(o=v,a=l(d,u))}},c=Z.layers,l=Z.spec.nodes||{};for(let e of[`added`,`moved`,`spc`])c[e]&&l[e]?.length&&s(F.positions,l[e],e=>({kind:`node`,index:e}));let u=Z.spec.ghost;return c.removed&&u?.nodes.length&&s(u.positions,u.nodes,(e,t)=>({kind:`ghost-node`,index:t})),a}function En(e,t,n,r,i,a,o){let s=Tn(e-n.left,t-n.top,a,o);if(s)return s;let c=Yt(r,i,a,o,Z.pick,Z.target),l=F.total,u=I?.rigids?.count||0,f=l+u+(Z.spec.ghost?.items.length||0),p=null,m=1/0;for(let e=0;e<K;e+=1)for(let t=0;t<K;t+=1){let n=(e*K+t)*4,r=d(c[n],c[n+1],c[n+2]);if(r===null||r>=f)continue;let i=(t-2)**2+(e-2)**2;i<m&&(m=i,p=r)}return p==null?Z.layers.onlyChanged||!Z.layers.unchanged?null:void 0:p<l?{kind:`element`,index:p}:p<l+u?{kind:`rbe`,index:p-l}:{kind:`ghost`,index:p-l-u}}function Dn(){if(!s.clientWidth||!s.clientHeight)return;let{w:e,h:t}=Ct(),n=e/t,r=Math.max(Math.min((w.right-w.left)/2,(w.top-w.bottom)/2),1e-9),i=(w.right+w.left)/2,a=(w.top+w.bottom)/2,o=n>=1?r*n:r,c=n>=1?r:r/n;w.left=i-o,w.right=i+o,w.top=a+c,w.bottom=a-c,w.updateProjectionMatrix(),E.aspect=n,E.updateProjectionMatrix();for(let n of nn)n.resolution.set(e,t);b.setPixelRatio(gt()),b.setSize(e,t,!1),N()}let On=typeof ResizeObserver<`u`?new ResizeObserver(Dn):null;On?.observe(s);let kn=null;function An(){kn?.removeEventListener?.(`change`,jn),kn=typeof window.matchMedia==`function`?window.matchMedia(`(resolution: ${window.devicePixelRatio||1}dppx)`):null,kn?.addEventListener?.(`change`,jn)}function jn(){An(),b.setPixelRatio(gt()),Dn()}return An(),N(),{setModel(e,{edges:t=!0,extras:n=null}={}){Rt(),F=e,I=n,V=t,L=new k(e.positions,3);let i=e.positions.length/3,a=new Float32Array(i),o=n?.groups?.nodeGroup;if(o)for(let e=0;e<i;e+=1)a[e]=o[e];Ue=new k(a,1);let s=n?.groups?.count||0,{tex:c,w:l}=Gt(s);z=c,R={uGroupVis:{value:c},uGroupVisW:{value:l},uNoGroup:{value:s},uColorByGroup:{value:0},uGroupPalette:{value:g.map(e=>new ve(e))},uNoGroupColor:{value:new ve(f)},uClassMask:{value:new v(1,1,1)},uClassColors:{value:p.map(e=>new ve(e))},uDepthBias:{value:.0015}},B=new O;let u=new T({visible:!1});for(let t of e.groups){let e=new O,n={root:e,shell:null,edges:null,beams:null,beamMats:[],shellMats:[],beamCards:[],shellCards:[],edgeMat:null};if(t.shell.length){let r=Mt(t.shell);(t.shellRanges?.length?t.shellRanges:[{card:``,start:0,count:t.shell.length}]).forEach((e,i)=>{r.addGroup(e.start,e.count,i),n.shellMats.push(Q(new ue({color:t.color,side:2,...ot,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1}),R,{colorable:!0})),n.shellCards.push(e.card)}),n.shell=new se(r,n.shellMats),e.add(n.shell)}if(t.edges.length&&(n.edgeMat=Q(new T({color:new ve(t.color).multiplyScalar(.45),transparent:!0,opacity:.55}),R),n.edges=new x(Mt(t.edges),n.edgeMat),n.edges.renderOrder=1,e.add(n.edges)),t.beams.length){let r=Mt(t.beams);(t.beamRanges?.length?t.beamRanges:[{card:``,start:0,count:t.beams.length}]).forEach((e,i)=>{r.addGroup(e.start,e.count,i),n.beamMats.push(Q(new T({color:t.color}),R,{colorable:!0})),n.beamCards.push(e.card)}),n.beams=new x(r,[...n.beamMats,u]),e.add(n.beams)}We.set(t.pid,n),B.add(e)}C.add(B),Kt(e),qt(),Wt(),$(),zt(r.iso.dir,r.iso.up),Zt()},setGroupVisible(e,t){t?Ge.delete(e):Ge.add(e),$()},setGroupsVisible(e){if(!J||!z)return;let t=Math.min(e.length,J.length-1);for(let n=0;n<t;n+=1)J[n]=e[n]?255:0;z.needsUpdate=!0,N()},setEdges(e){V=!!e,$()},setMarkers(e){Je={...Je,...e},$()},setNodes(e){Qe={...Qe,...e},$()},setNodeSet(e,{color:t=c.spc}={}){It(),F&&e?.length&&(Ze=new Ie(Mt(Uint32Array.from(e)),Q(new ee({color:t,size:at,sizeAttenuation:!1,depthTest:!1}),R)),Ze.renderOrder=6,C.add(Ze)),$()},setColorMode(e){H=e,Wt()},async setRenderMode(e,{onProgress:t}={}){if(!F)return{fallbacks:0};if(Ke=e===`section`?`section`:`line`,Ke===`section`&&!W){if(!await en(t))return{fallbacks:0,cancelled:!0};Z&&(mn(!0),Sn()),Wt()}return $(),{fallbacks:W?.fallbacks||0}},setClip(e){if(St=e&&e.axis?e:null,!St||!F)j=mt;else{let e={x:0,y:1,z:2}[St.axis],t=F.bounds||{min:[-F.radius,-F.radius,-F.radius],max:[F.radius,F.radius,F.radius]},n=t.min[e]+(t.max[e]-t.min[e])*Math.min(Math.max(St.position,0),1),r=[0,0,0];r[e]=St.flip?1:-1,M.normal.set(...r),M.constant=St.flip?-n:n,j=[M]}N()},setProjection(e){Vt(e===`persp`?E:w)},setView(e){let t=r[e]||r.iso;Y?.bounds?zt(t.dir,t.up,Y.bounds.center,Y.bounds.radius):zt(t.dir,t.up)},fit(){F&&(Y?.bounds?Bt(Y.bounds.center,Y.bounds.radius):Bt([0,0,0],F.radius))},frameNodes(e){if(!F)return;let t=n(F.positions,e,F.radius*.12);t&&Bt(t.center,t.radius*1.15)},pickAt(e,t){if(!F)return null;let n=S.getBoundingClientRect(),r=Math.max(Math.round(n.width),1),i=Math.max(Math.round(n.height),1),a=Math.floor(e-n.left),o=Math.floor(t-n.top);if(a<0||o<0||a>=r||o>=i||Y)return null;if(Z){let s=En(e,t,n,a,o,r,i);if(s!==void 0)return N(),s}let s=$t(e-n.left,t-n.top,r,i);if(s!=null)return{kind:`node`,index:s};X||(kt(),Jt());let c=Yt(a,o,r,i),l=null,u=1/0,f=F.total+(I?.rigids?.count||0);for(let e=0;e<K;e+=1)for(let t=0;t<K;t+=1){let n=(e*K+t)*4,r=d(c[n],c[n+1],c[n+2]);if(r===null||r>=f)continue;let i=(t-2)**2+(e-2)**2;i<u&&(u=i,l=r)}return N(),l==null?null:l<F.total?{kind:`element`,index:l}:{kind:`rbe`,index:l-F.total}},highlight(e){Nt();let t=cn(e);if(!t||!F){N();return}let n=ln(t);if(!n){N();return}let r=new O;if(n.segs.length&&(r.add(rn(n.segs,G.outline,G.elemOutlinePx,.5,10)),r.add(rn(n.segs,G.core,G.elemPx,.8,11))),t.kind!==`element`&&(n.points||n.nodes.length)){let e=n.points||(t.kind===`node`?n.nodes:n.nodes.slice(0,1)).flatMap(tn),i=sn(e,G.outline,G.nodeOutlinePx,!1,.5);i.renderOrder=12;let a=sn(e,G.core,G.nodePx,!1,.8);a.renderOrder=13,r.add(i,a)}vt=r,C.add(r),N()},setIsolate(e){Pt();let r=cn(e);if(r&&F&&I){let e=ln(r);if(e){let i=new O,a=r.kind===`element`?[r.index]:r.kind===`node`?un(r.index):[];for(let e of a)fn(e,i);if(r.kind===`rbe`){let t=I.rigids.kind[r.index]===0?`rbe2`:`rbe3`;i.add(an(e.segs,c[t],!0))}let o=new Set(e.nodes);for(let e of a)for(let n of t(I,F,e))o.add(n);i.add(on([...o],p[0],6,!0)),C.add(i),Y={obj:i,bounds:n(F.positions,[...o],F.radius*.04)}}}$()},getCameraState(){if(!F)return null;let{w:e,h:t}=Ct(),n=e/t,r=D.position.distanceTo(P.target),i=D===w?Math.min((w.right-w.left)/2,(w.top-w.bottom)/2)/w.zoom:r*Math.tan(ct*Math.PI/360)*Math.min(1,n);return{projection:D===w?`ortho`:`persp`,position:D.position.toArray(),target:P.target.toArray(),quaternion:D.quaternion.toArray(),up:D.up.toArray(),view:i,radius:F.radius,center:[...F.center]}},setCameraState(e){if(F&&e?.position&&e?.target){Ve+=1;try{e.projection&&e.projection===`persp`!=(D===E)&&Vt(e.projection===`persp`?E:w);let t=F.radius,n=new v(...e.target),r=new v(...e.position);if(D===E&&e.projection===`ortho`&&e.view>0){let{w:t,h:i}=Ct(),a=e.view/(Math.tan(ct*Math.PI/360)*Math.min(1,t/i));r.sub(n).normalize().multiplyScalar(a).add(n)}if(D.position.copy(r),P.target.copy(n),D===w){w.zoom=Le((w.right-w.left)/2,(w.top-w.bottom)/2,e.view);let n=r.length()+t*20;w.near=-n,w.far=n}else{let e=r.distanceTo(n);E.near=Math.max(e*.001,t*1e-5),E.far=r.length()+t*8}D.up.copy(st),D.updateProjectionMatrix(),P.update()}finally{--Ve}N()}},onCameraChange(e){return Be.add(e),()=>Be.delete(e)},setPidHighlight(e){Ft();let t=new Set((e||[]).map(Number)),n=0;if(F&&t.size){let e=new O;for(let r of F.groups)if(t.has(r.pid)){if(n+=1,r.beams.length){let t=r.beams.length/2;if(t<=ft){let n=new Float32Array(t*6),i=F.positions;for(let e=0;e<r.beams.length;e+=1){let t=r.beams[e];n[e*3]=i[t*3],n[e*3+1]=i[t*3+1],n[e*3+2]=i[t*3+2]}e.add(rn(n,G.outline,G.elemOutlinePx,.5,8)),e.add(rn(n,G.core,3,.95,9))}else{let t=new x(Mt(r.beams),Q(new T({color:G.core,depthTest:!1}),R));t.renderOrder=9,e.add(t)}}if(r.shell.length){let t=new se(Mt(r.shell),Q(new ce({color:G.core,transparent:!0,opacity:.35,depthTest:!1,depthWrite:!1,side:2}),R));t.renderOrder=8,e.add(t)}if(r.edges.length){let t=new x(Mt(r.edges),Q(new T({color:G.core,depthTest:!1,transparent:!0,opacity:.9}),R));t.renderOrder=9,e.add(t)}}e.children.length&&(xt=e,C.add(e))}return $(),n},setDiff(e){let t=Z?.layers;xn(),F&&e?(Z=wn(e),t&&(Z.layers=t),Ht()&&Sn(),mn(!0)):mn(!1),Wt(),$()},setDiffLayers(e){Z&&(Z.layers={...Z.layers,...e},$())},setDiffFocus(e){if(Z){if(yn(),e){let t=new O;if(e.segs?.length&&t.add(_n(Float32Array.from(e.segs),p[0],2,8,{opacity:.75,dashed:!0})),e.arrow){let{from:n,to:r}=e.arrow;t.add(_n(Float32Array.from([...n,...r]),l.changed,2,8,{opacity:.9,dashed:!0}))}if(e.points?.length){let n=sn(e.points,p[0],12,!1,.7,yt());n.renderOrder=9,t.add(n)}Z.focus=t,C.add(t)}$()}},frameDiff(){if(!F||!Z)return!1;let e=Z.spec,t=[1/0,1/0,1/0],n=[-1/0,-1/0,-1/0],r=0,i=(e,i)=>{for(let r=0;r<3;r+=1){let a=e[i*3+r];a<t[r]&&(t[r]=a),a>n[r]&&(n[r]=a)}r+=1};for(let t of e.frameNodes||[])i(F.positions,t);let a=e.ghost?.positions;if(a)for(let e=0;e<a.length/3;e+=1)i(a,e);return r?(Bt([0,1,2].map(e=>(t[e]+n[e])/2),Math.max(Math.hypot(n[0]-t[0],n[1]-t[1],n[2]-t[2])/2,F.radius*.12)*1.15),!0):!1},dispose(){Be.clear(),cancelAnimationFrame(je),je=0,On?.disconnect(),kn?.removeEventListener?.(`change`,jn),kn=null,P.removeEventListener(`change`,N),P.removeEventListener(`change`,He),P.dispose(),Rt(),q(C),q(De.scene),S.removeEventListener(`webglcontextlost`,At),S.removeEventListener(`webglcontextrestored`,jt),b.dispose(),b.forceContextLoss?.(),S.remove()}}}export{Ot as createViewerEngine};