import { formatsByName, formatsByCoinType } from '@ensdomains/address-encoder'
import { abi as ensContract } from '@ensdomains/contracts/abis/ens/ENS.json'
import { utils, BigNumber, ethers } from 'ethers'
import {
  getENSContract,
  getResolverContract,
  getReverseRegistrarContract
} from './contracts'
import {
  emptyAddress,
  getEnsStartBlock,
  labelhash,
  namehash,
  uniq
} from './utils'
import { decodeContenthash, encodeContenthash } from './utils/contents'
import { encodeLabelhash } from './utils/labelhash'
import {
  getAccount,
  getNetworkId,
  getProvider,
  getSigner,
  getWeb3
} from './web3'
import { interfaces } from './constants/interfaces'
import { registryAddress, addresses } from './constants/contractsAddress'
import PublicResolverABI from './abis/PublicResolver.json'
import RegistrarABI from './abis/UniversalRegistry.json'
import BaseRegistrarABI from './abis/BaseRegistrar.json'

/* Utils */

export function getNamehash(name) {
  return namehash(name)
}

async function getNamehashWithLabelHash(labelHash, nodeHash) {
  let node = utils.keccak256(nodeHash + labelHash.slice(2))
  return node.toString()
}

function getLabelhash(label) {
  return labelhash(label)
}

const contracts = registryAddress

export class ENS {
  constructor({ networkId, registryAddress, provider }) {
    this.contracts = contracts
    const hasRegistry =
      this.contracts[networkId] &&
      Object.keys(this.contracts[networkId]).includes('registry')

    if (!hasRegistry && !registryAddress) {
      throw new Error(`Unsupported network ${networkId}`)
    } else if (this.contracts[networkId] && !registryAddress) {
      registryAddress = contracts[networkId].registry
    }
    this.networkId = networkId
    this.registryAddress = addresses[networkId].registrar

    const ENSContract = getENSContract({ address: registryAddress, provider })
    this.ENS = ENSContract
  }

  /* Get the raw Ethers contract object */
  getENSContractInstance() {
    return this.ENS
  }

  /* Main methods */

  // TODO: ethers.js does not support owner
  async getOwner(name) {
    const provider = await getProvider()
    const registrarInstance = await this._getRegistrarContract(provider)
    if (!registrarInstance) return emptyAddress
    const namehash = getNamehash(name)
    const owner = await registrarInstance.owner(namehash)
    return owner
  }

  async getResolver(name) {
    const provider = await getProvider()
    let resolver = await provider.getResolver(name)
    if (resolver) {
      return resolver.address
    }
  }

  async _getResolverObject(name) {
    // 这里的getResolver 是ethers.js 专门为ens提供的，可以根据域名来获取解析器
    const provider = await getProvider()
    return provider.getResolver(name)
  }

  async _getResolverContract(signerOrProvider) {
    const publicResolver = new ethers.Contract(
      addresses[this.networkId].publicResolver,
      PublicResolverABI.abi,
      signerOrProvider
    )
    return publicResolver
  }

  async _getRegistrarContract(signerOrProvider) {
    const registrar = new ethers.Contract(
      addresses[this.networkId].registrar,
      RegistrarABI.abi,
      signerOrProvider
    )
    return registrar
  }

  async _getBnbRegistrarContract(signerOrProvider) {
    const registrar = new ethers.Contract(
      addresses[this.networkId].bnbRegistrar,
      BaseRegistrarABI.abi,
      signerOrProvider
    )
    return registrar
  }

  // TODO: ethers.js does not support ttl
  async getTTL(name) {
    const namehash = getNamehash(name)
    return this.ENS.ttl(namehash)
  }

  // TODO: ethers.js does not support lookup by namehash
  async getResolverWithLabelhash(labelhash, nodehash) {
    const namehash = await getNamehashWithLabelHash(labelhash, nodehash)
    return this.ENS.resolver(namehash)
  }

  // TODO: ethers.js does not support lookup by namehash
  async getOwnerWithLabelHash(labelhash, nodeHash) {
    const namehash = await getNamehashWithLabelHash(labelhash, nodeHash)
    return this.ENS.owner(namehash)
  }

  async getAddress(name) {
    return this.getAddr(name, 'ETH')
  }

  async getExpiryTime(name) {
    const provider = await getProvider()
    const bnbRegistrarInstance = await this._getBnbRegistrarContract(provider);
    if(!bnbRegistrarInstance) return emptyAddress
    // namehash = token
    const namehash = getNamehash(name);
    const expiryTime = await bnbRegistrarInstance.nameExpires(namehash);

    return expiryTime.toNumber();
  }

  async getBaseInfo(name) {
    const provider = await getProvider()
    const bnbRegistrarInstance = await this._getBnbRegistrarContract(provider);
    const registrarInstance = await this._getRegistrarContract(provider);
    if(!bnbRegistrarInstance || !registrarInstance) return emptyAddress

    // namehash = token
    const namehash = getNamehash(name);
    const expiryTime = await bnbRegistrarInstance.nameExpires(namehash);
    const owner = await registrarInstance.owner(namehash);

    return {
      owner,
      expiryTime: expiryTime.toNumber()
    }
  }

  async getRegistrantList(owner) {
    const provider = await getProvider()
    const bnbRegistrarInstance = await this._getBnbRegistrarContract(provider)
    if (!bnbRegistrarInstance) return emptyAddress
    let tokens = []
    let list = []
    const balance = await bnbRegistrarInstance.balanceOf(owner)
    for (let i = 0; i < balance.toNumber(); i++) {
      tokens.push(await bnbRegistrarInstance.tokenOfOwnerByIndex(owner, i))
    }

    for (let i = 0; i < tokens.length; i++) {
      let name = await bnbRegistrarInstance.nameOf(tokens[i])
      let tld = await bnbRegistrarInstance.tld()
      let expire = await bnbRegistrarInstance.nameExpires(tokens[i])
      list.push({
        name: name + '.' + tld,
        registrar: 'Jaz DID',
        chain: 'BNB',
        expires: expire.toNumber()
      })
    }

    return list
  }

  async getAddr(name, key) {
    if (!name) return emptyAddress
    const provider = await getProvider()
    const publicResolverInstance = await this._getResolverContract(provider)
    if (!publicResolverInstance) return emptyAddress
    const namehash = getNamehash(name)
    const result = await publicResolverInstance.addr(namehash)
    // try {
    //   const { coinType, encoder } = formatsByName[key]
    //   const encodedCoinType = utils.hexZeroPad(BigNumber.from(coinType).toHexString(), 32)
    //   const data = await resolver._fetchBytes('0xf1cb7e06', encodedCoinType)
    //   if([emptyAddress, '0x', null].includes(data) ) return emptyAddress
    //   let buffer = Buffer.from(data.slice(2), "hex")
    //   return encoder(buffer);
    // } catch (e) {
    //   console.log(e)
    //   console.warn(
    //     'Error getting addr on the resolver contract, are you sure the resolver address is a resolver contract?'
    //   )
    //   return emptyAddress
    // }
    return result
  }

  async getContent(name) {
    const provider = await getProvider()
    const publicResolverInstance = await this._getResolverContract(provider)
    if (!publicResolverInstance) return emptyAddress
    try {
      const namehash = getNamehash(name)
      const result = await publicResolverInstance.contenthash(namehash)
      return result
      // const contentHashSignature = utils
      //   .solidityKeccak256(['string'], ['contenthash(bytes32)'])
      //   .slice(0, 10)

      // const isContentHashSupported = await Resolver.supportsInterface(
      //   contentHashSignature
      // )
      // if (isContentHashSupported) {
      //   // use _fetchBytes as ethers.js currently only supports ipfs
      //   const encoded = await resolver._fetchBytes('0xbc1c58d1')
      //   const { protocolType, decoded, error } = decodeContenthash(encoded)

      //   if (error) {
      //     return {
      //       value: error,
      //       contentType: 'error'
      //     }
      //   }
      //   return {
      //     value: `${protocolType}://${decoded}`,
      //     contentType: 'contenthash'
      //   }
      // } else {
      //   const value = await Resolver.content(namehash)
      //   return {
      //     value,
      //     contentType: 'oldcontent'
      //   }
      // }
    } catch (e) {
      const message =
        'Error getting content on the resolver contract, are you sure the resolver address is a resolver contract?'
      console.warn(message, e)
      return { value: message, contentType: 'error' }
    }
  }

  async getText(name, key) {
    const provider = await getProvider()
    const publicResolverInstance = await this._getResolverContract(provider)
    if (!publicResolverInstance) return emptyAddress
    const namehash = getNamehash(name)
    try {
      const result = await publicResolverInstance.text(namehash, key)
      return result
    } catch (e) {
      console.warn(
        'Error getting text record on the resolver contract, are you sure the resolver address is a resolver contract?'
      )
      return ''
    }
  }

  async getName(address) {
    const provider = await getProvider()
    const name = await provider.lookupAddress(address)
    return {
      name
    }
  }

  async isMigrated(name) {
    const namehash = getNamehash(name)
    return this.ENS.recordExists(namehash)
  }

  async getResolverDetails(node) {
    try {
      const addrPromise = this.getAddress(node.name)
      const contentPromise = this.getContent(node.name)
      const [addr, content] = await Promise.all([addrPromise, contentPromise])

      return {
        ...node,
        addr,
        content: content.value,
        contentType: content.contentType
      }
    } catch (e) {
      return {
        ...node,
        addr: '0x0',
        content: '0x0',
        contentType: 'error'
      }
    }
  }

  async getSubdomains(name) {
    const startBlock = await getEnsStartBlock()
    const namehash = getNamehash(name)
    const rawLogs = await this.getENSEvent('NewOwner', {
      topics: [namehash],
      fromBlock: startBlock
    })
    const flattenedLogs = rawLogs.map((log) => log.args.label)
    flattenedLogs.reverse()
    const labelhashes = uniq(flattenedLogs)
    const ownerPromises = labelhashes.map((label) =>
      this.getOwnerWithLabelHash(label, namehash)
    )

    return Promise.all(ownerPromises).then((owners) =>
      owners.map((owner, index) => {
        return {
          label: null,
          labelhash: labelhashes[index],
          decrypted: false,
          node: name,
          name: `${encodeLabelhash(labelhashes[index])}.${name}`,
          owner
        }
      })
    )
  }

  async getDomainDetails(name) {
    const nameArray = name.split('.')
    const labelhash = getLabelhash(nameArray[0])
    const [owner, resolver] = await Promise.all([
      this.getOwner(name),
      addresses[this.networkId].publicResolver
    ])
    const node = {
      name,
      label: nameArray[0],
      labelhash,
      owner,
      resolver
    }

    const hasResolver = parseInt(node.resolver, 16) !== 0

    if (hasResolver) {
      return this.getResolverDetails(node)
    }

    return {
      ...node,
      addr: null,
      content: null
    }
  }

  /* non-constant functions */

  async setOwner(name, newOwner) {
    const ENSWithoutSigner = this.ENS
    const signer = await getSigner()
    const ENS = ENSWithoutSigner.connect(signer)
    const namehash = getNamehash(name)
    return ENS.setOwner(namehash, newOwner)
  }

  async setSubnodeOwner(name, newOwner) {
    const ENSWithoutSigner = this.ENS
    const signer = await getSigner()
    const ENS = ENSWithoutSigner.connect(signer)
    const nameArray = name.split('.')
    const label = nameArray[0]
    const node = nameArray.slice(1).join('.')
    const labelhash = getLabelhash(label)
    const parentNamehash = getNamehash(node)
    return ENS.setSubnodeOwner(parentNamehash, labelhash, newOwner)
  }

  async setSubnodeRecord(name, newOwner, resolver) {
    const ENSWithoutSigner = this.ENS
    const signer = await getSigner()
    const ENS = ENSWithoutSigner.connect(signer)
    const nameArray = name.split('.')
    const label = nameArray[0]
    const node = nameArray.slice(1).join('.')
    const labelhash = getLabelhash(label)
    const parentNamehash = getNamehash(node)
    const ttl = await this.getTTL(name)
    return ENS.setSubnodeRecord(
      parentNamehash,
      labelhash,
      newOwner,
      resolver,
      ttl
    )
  }

  async setResolver(name, resolver) {
    const namehash = getNamehash(name)
    const ENSWithoutSigner = this.ENS
    const signer = await getSigner()
    const ENS = ENSWithoutSigner.connect(signer)
    return ENS.setResolver(namehash, resolver)
  }

  async setAddress(name, address) {
    const resolverAddr = await this.getResolver(name)
    return this.setAddressWithResolver(name, address, resolverAddr)
  }

  async setAddressWithResolver(name, address, resolverAddr) {
    const namehash = getNamehash(name)
    const provider = await getProvider()
    const ResolverWithoutSigner = getResolverContract({
      address: resolverAddr,
      provider
    })
    const signer = await getSigner()
    const Resolver = ResolverWithoutSigner.connect(signer)
    return Resolver['setAddr(bytes32,address)'](namehash, address)
  }

  async setAddr(name, key, address) {
    const resolverAddr = await this.getResolver(name)
    return this.setAddrWithResolver(name, key, address, resolverAddr)
  }

  async setAddrWithResolver(name, key, address, resolverAddr) {
    const namehash = getNamehash(name)
    const provider = await getProvider()
    const ResolverWithoutSigner = getResolverContract({
      address: resolverAddr,
      provider
    })
    const signer = await getSigner()
    const Resolver = ResolverWithoutSigner.connect(signer)
    const { decoder, coinType } = formatsByName[key]
    let addressAsBytes
    if (!address || address === '') {
      addressAsBytes = Buffer.from('')
    } else {
      addressAsBytes = decoder(address)
    }
    return Resolver['setAddr(bytes32,uint256,bytes)'](
      namehash,
      coinType,
      addressAsBytes
    )
  }

  async setContent(name, content) {
    const resolverAddr = await this.getResolver(name)
    return this.setContentWithResolver(name, content, resolverAddr)
  }

  async setContentWithResolver(name, content, resolverAddr) {
    const namehash = getNamehash(name)
    const provider = await getProvider()
    const ResolverWithoutSigner = getResolverContract({
      address: resolverAddr,
      provider
    })
    const signer = await getSigner()
    const Resolver = ResolverWithoutSigner.connect(signer)
    return Resolver.setContent(namehash, content)
  }

  async setContenthash(name, content) {
    const resolverAddr = await this.getResolver(name)
    return this.setContenthashWithResolver(name, content, resolverAddr)
  }

  async setContenthashWithResolver(name, content, resolverAddr) {
    let encodedContenthash = content
    if (parseInt(content, 16) !== 0) {
      encodedContenthash = encodeContenthash(content)
    }
    const namehash = getNamehash(name)
    const provider = await getProvider()
    const ResolverWithoutSigner = getResolverContract({
      address: resolverAddr,
      provider
    })

    const signer = await getSigner()
    const Resolver = ResolverWithoutSigner.connect(signer)
    return Resolver.setContenthash(namehash, encodedContenthash.encoded)
  }

  async setText(name, key, recordValue) {
    const resolverAddr = await this.getResolver(name)
    return this.setTextWithResolver(name, key, recordValue, resolverAddr)
  }

  async setTextWithResolver(name, key, recordValue, resolverAddr) {
    const namehash = getNamehash(name)
    const provider = await getProvider()
    const ResolverWithoutSigner = getResolverContract({
      address: resolverAddr,
      provider
    })
    const signer = await getSigner()
    const Resolver = ResolverWithoutSigner.connect(signer)
    return Resolver.setText(namehash, key, recordValue)
  }

  async createSubdomain(name) {
    const account = await getAccount()
    const publicResolverAddress = await this.getAddress('resolver.eth')
    try {
      return this.setSubnodeRecord(name, account, publicResolverAddress)
    } catch (e) {
      console.log('error creating subdomain', e)
    }
  }

  async deleteSubdomain(name) {
    try {
      return this.setSubnodeRecord(name, emptyAddress, emptyAddress)
    } catch (e) {
      console.log('error deleting subdomain', e)
    }
  }

  async claimAndSetReverseRecordName(name, overrides = {}) {
    const reverseRegistrarAddr = await this.getOwner('addr.reverse')
    const provider = await getProvider()
    const reverseRegistrarWithoutSigner = getReverseRegistrarContract({
      address: reverseRegistrarAddr,
      provider
    })
    const signer = await getSigner()
    const reverseRegistrar = reverseRegistrarWithoutSigner.connect(signer)
    const networkId = await getNetworkId()

    if (parseInt(networkId) > 1000) {
      const gasLimit = await reverseRegistrar.estimateGas.setName(name)
      overrides = {
        gasLimit: gasLimit.toNumber() * 2,
        ...overrides
      }
    }

    return reverseRegistrar.setName(name, overrides)
  }

  async setReverseRecordName(name) {
    const account = await getAccount()
    const provider = await getProvider()
    const reverseNode = `${account.slice(2)}.addr.reverse`
    const resolverAddr = await this.getResolver(reverseNode)
    const ResolverWithoutSigner = getResolverContract({
      address: resolverAddr,
      provider
    })
    const signer = await getSigner()
    const Resolver = ResolverWithoutSigner.connect(signer)
    let namehash = getNamehash(reverseNode)
    return Resolver.setName(namehash, name)
  }
  async supportsWildcard(name) {
    const provider = await getProvider()
    const resolverAddress = await this.getResolver(name)
    const Resolver = getResolverContract({
      address: resolverAddress,
      provider
    })
    return Resolver['supportsInterface(bytes4)'](interfaces['resolve'])
  }
  // Events

  async getENSEvent(event, { topics, fromBlock }) {
    const provider = await getWeb3()
    const { ENS } = this
    const ensInterface = new utils.Interface(ensContract)
    let Event = ENS.filters[event]()

    const filter = {
      fromBlock,
      toBlock: 'latest',
      address: Event.address,
      topics: [...Event.topics, ...topics]
    }

    const logs = await provider.getLogs(filter)

    const parsed = logs.map((log) => {
      const parsedLog = ensInterface.parseLog(log)
      return parsedLog
    })

    return parsed
  }
}
